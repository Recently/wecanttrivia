<?php
// submit_trivia_via_API.php

header('Content-Type: application/json; charset=utf-8');
date_default_timezone_set('America/New_York');

// ─── Configuration ───────────────────────────────────────────────────────────
$host    = 'localhost';
$dbName  = '';
$user    = '';
$pass    = '';

define('API_KEY', '');  // Must match discord bot
define('MAP_TABLE', 'discord_rsn_map');
// ─── End configuration ───────────────────────────────────────────────────────

try {
    $pdo = new PDO(
        "mysql:host={$host};dbname={$dbName};charset=utf8mb4",
        $user, $pass,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'DB connection failed']);
    exit;
}

// ─── Router ─────────────────────────────────────────────────────────────────
if (!empty($_SERVER['PATH_INFO'])) {
    $path = rtrim($_SERVER['PATH_INFO'], '/');
} elseif (!empty($_GET['action'])) {
    $path = '/' . $_GET['action'];
} else {
    $path = '';
}
$method = $_SERVER['REQUEST_METHOD'];

if      ($path === '/register'    && $method === 'POST') { handleRegister($pdo); }
elseif  ($path === '/submit'      && $method === 'POST') { handleSubmit($pdo); }
elseif  ($path === '/leaderboard' && $method === 'GET' ) { handleLeaderboard($pdo); }
else {
    http_response_code(404);
    echo json_encode(['error' => 'Not Found']);
    exit;
}

// ─── Handlers ───────────────────────────────────────────────────────────────

function handleRegister(PDO $pdo)
{
    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) returnError(400, 'Invalid JSON');

    foreach (['discord_id', 'rsn'] as $f) {
        if (empty($data[$f])) returnError(422, "Missing field: {$f}");
    }

    $discordId = trim($data['discord_id']);
    $rsn       = trim($data['rsn']);

    if (!preg_match('/^\d{15,20}$/', $discordId)) {
        returnError(422, 'Invalid Discord ID format');
    }
    if (!preg_match('/^[\w\s-]{1,25}$/u', $rsn)) {
        returnError(422, 'Invalid RSN format (1–25 alphanumeric characters)');
    }

    $sql = "INSERT INTO " . MAP_TABLE . " (discord_id, rsn, updated_at)
            VALUES (:d, :r, NOW())
            ON DUPLICATE KEY UPDATE rsn = :r, updated_at = NOW()";
    $stmt = $pdo->prepare($sql);
    if (!$stmt->execute([':d' => $discordId, ':r' => $rsn])) {
        returnError(500, 'DB upsert failed');
    }

    echo json_encode(['success' => true]);
    exit;
}

function handleSubmit(PDO $pdo)
{
    $provided = $_GET['api_key'] ?? ($_SERVER['HTTP_X_API_KEY'] ?? '');
    if (!$provided || !hash_equals(API_KEY, $provided)) {
        returnError(401, 'Unauthorized');
    }

    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) returnError(400, 'Invalid JSON');

    foreach (['discord_id', 'question', 'answer'] as $f) {
        if (empty($data[$f])) returnError(422, "Missing field: {$f}");
    }

    $discordId = trim($data['discord_id']);
    $question  = trim($data['question']);
    $answer    = trim($data['answer']);

    if (!preg_match('/^\d{15,20}$/', $discordId)) {
        returnError(422, 'Invalid Discord ID format');
    }
    if (!preg_match('/^.{5,150}$/u', $question)) {
        returnError(422, 'Question must be 5–150 characters');
    }
    if (!preg_match('/^.{1,75}$/u', $answer)) {
        returnError(422, 'Answer must be 1–75 characters');
    }

    $stmt = $pdo->prepare("SELECT rsn FROM " . MAP_TABLE . " WHERE discord_id = :d");
    $stmt->execute([':d' => $discordId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) returnError(403, 'RSN not registered. Please run `/register` first.');
    $rsn = substr(trim($row['rsn']), 0, 25);

    $weekId = (!empty($data['week_id']) && is_numeric($data['week_id']))
        ? (int)$data['week_id']
        : (int)($pdo->query("SELECT id FROM trivia_weeks WHERE is_closed = 0 ORDER BY id DESC LIMIT 1")->fetchColumn() ?: 0);

    $ip  = $_SERVER['REMOTE_ADDR'] ?? null;
    $now = date('Y-m-d H:i:s');

    $stmt = $pdo->prepare("SELECT is_closed, end_datetime FROM trivia_weeks WHERE id = :w");
    $stmt->execute([':w' => $weekId]);
    $week = $stmt->fetch(PDO::FETCH_ASSOC);

    $table = ($week && ($week['is_closed'] || ($week['end_datetime'] && $now > $week['end_datetime'])))
           ? 'trivia_submissions_overflow'
           : 'trivia_submissions';

    $sql = "INSERT INTO {$table} (week_id, rsn, question, answer, ip_address, date_time)
            VALUES (:w, :r, :q, :a, :ip, :dt)";
    $ins = $pdo->prepare($sql);
    if (!$ins->execute([
        ':w'  => $weekId,
        ':r'  => $rsn,
        ':q'  => $question,
        ':a'  => $answer,
        ':ip' => $ip,
        ':dt' => $now,
    ])) {
        returnError(500, 'DB insert failed');
    }

    echo json_encode([
        'success'  => true,
        'overflow' => ($table === 'trivia_submissions_overflow')
    ]);
    exit;
}

function handleLeaderboard(PDO $pdo)
{
    $limit = isset($_GET['limit']) ? min(100, (int)$_GET['limit']) : 10;
    $rsn   = isset($_GET['rsn']) ? trim($_GET['rsn']) : null;

    if ($rsn && !preg_match('/^[\w\s-]{1,25}$/u', $rsn)) {
        returnError(422, 'Invalid RSN format');
    }

    if ($rsn) {
        $stmt = $pdo->prepare("SELECT user_id AS rsn, score FROM trivia_leaderboard WHERE user_id = :r");
        $stmt->execute([':r' => $rsn]);
    } else {
        $stmt = $pdo->prepare("SELECT user_id AS rsn, score FROM trivia_leaderboard ORDER BY score DESC LIMIT :l");
        $stmt->bindValue(':l', $limit, PDO::PARAM_INT);
        $stmt->execute();
    }

    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    echo json_encode(['count' => count($rows), 'data' => $rows]);
    exit;
}

function returnError(int $code, string $msg)
{
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}
