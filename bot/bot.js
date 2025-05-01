// bot.js
import { Client, GatewayIntentBits } from 'discord.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import winston from 'winston';
import 'winston-daily-rotate-file';
import { readFileSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
dotenv.config();
const BOT_VERSION = '0.3.2 Alpha';
const DEBUG = process.env.DEBUG_LOGGING === 'true';

const transport = new winston.transports.DailyRotateFile({
  filename: 'logs/bot-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: false,
  maxFiles: '2d',
});

const logger = winston.createLogger({
  level: DEBUG ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] [${level}] ${message}`)
  ),
  transports: [transport, new winston.transports.Console()],
});

logger.info('Bot starting…');
if (DEBUG) logger.debug('Debug logging ENABLED');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  logger.info(`Logged in as ${client.user.tag}`);
  logger.info(`Created by Recent - Version ${BOT_VERSION}`);
  if (DEBUG) logger.debug('Ready event fired');
});

async function safeDeferReply(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });
    logger.debug('Deferred reply successfully');
    return true;
  } catch (err) {
    logger.error(`[deferReply] Failed with error code ${err.code} — likely timed out`);
    return false;
  }
}

async function handleHelpTrivia(interaction) {
  const content = [
    '📋 **Trivia Bot Help**',
    'If the bot no worky - you can submit your trivia questions here: https://wecantread.club/trivia/',
    'If you receive "command not found", try again after a few seconds.',
    '',
    '• First register: `/register rsn:<Your RSN>`',
    '• Then submit: `/submit question:<Your Question> answer:<Correct Answer> [week:<Number>]`'
  ].join('\n');
  await interaction.followUp({ content, ephemeral: false });
}

async function handleVersion(interaction) {
  const content = `📦 Trivia Bot version: ${BOT_VERSION}`;
  await interaction.followUp({ content, ephemeral: false });
}

async function handlePing(interaction) {
  const sent = Date.now();
  const reply = await interaction.followUp({ content: 'Pinging...', fetchReply: true, ephemeral: false });
  const latency = reply.createdTimestamp - sent;
  await interaction.editReply({ content: `🏓 Pong! Latency is ${latency}ms.` });
}

async function handleRegister(interaction, opts) {
  const rsn = opts.getString('rsn');
  if (!rsn) {
    await interaction.followUp({ content: '❌ You must provide an RSN to register!', ephemeral: true });
    return;
  }
  const res = await fetch(`${process.env.API_URL}?action=register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': process.env.API_KEY
    },
    body: JSON.stringify({ discord_id: interaction.user.id, rsn }),
  });
  const json = await res.json();
  logger.debug(`Register response: ${res.status} | ${JSON.stringify(json)}`);
  const content = res.ok && !json.error
    ? `✅ Registered as **${rsn}**`
    : `❌ Registration failed: ${json.error || 'Unknown error'}`;
  await interaction.followUp({ content, ephemeral: false });
}

async function handleSubmit(interaction, opts) {
  const question = opts.getString('question');
  const answer = opts.getString('answer');
  if (!question || !answer) {
    await interaction.followUp({ content: '❌ You must supply both `question` and `answer`!', ephemeral: true });
    return;
  }
  const weekOpt = opts.getInteger('week');
  const payload = {
    discord_id: interaction.user.id,
    question,
    answer,
  };
  if (Number.isInteger(weekOpt)) payload.week_id = weekOpt - 1;

  const res = await fetch(`${process.env.API_URL}?action=submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': process.env.API_KEY
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  logger.debug(`Submit response: ${res.status} | ${JSON.stringify(json)}`);
  const content = res.ok && !json.error
    ? '✅ Question submitted, good luck!'
    : `❌ Submission failed: ${json.error || 'Unknown error'}`;
  await interaction.followUp({ content, ephemeral: false });
}

client.on('interactionCreate', async (interaction) => {
  const start = Date.now();
  const interactionId = interaction.id;

  logger.debug(`interactionCreate: ${interactionId}`);

  if (!interaction.isChatInputCommand()) {
    try {
      await interaction.reply({ content: '❓ Sorry, I only handle slash commands!', ephemeral: true });
    } catch (e) {
      logger.error(`[reply] Failed to handle non-chat command: ${e}`);
    }
    return;
  }

  const cmd = interaction.commandName;
  const opts = interaction.options;
  logger.debug(`Received /${cmd} | Options: ${JSON.stringify(opts.data)}`);

  // Only defer if we’re within 2.5s
  const TIMEOUT_LIMIT_MS = 2500;
  const elapsed = Date.now() - start;
  let deferred = false;

  if (elapsed < TIMEOUT_LIMIT_MS) {
    deferred = await safeDeferReply(interaction);
  } else {
    logger.warn(`[${cmd}] Too late to defer reply (took ${elapsed}ms)`);
    return;
  }

  if (!deferred) return; // Avoid followUp if defer failed

  try {
    switch (cmd) {
      case 'helptrivia':
        await handleHelpTrivia(interaction);
        break;
      case 'version':
        await handleVersion(interaction);
        break;
      case 'ping':
        await handlePing(interaction);
        break;
      case 'register':
        await handleRegister(interaction, opts);
        break;
      case 'submit':
        await handleSubmit(interaction, opts);
        break;
      default:
        await interaction.followUp({ content: '❓ Unknown command', ephemeral: true });
    }
  } catch (err) {
    logger.error(`[${cmd}] handler error: ${err}`);
    try {
      await interaction.followUp({ content: '⚠️ An unexpected error occurred.', ephemeral: true });
    } catch (e) {
      logger.error(`[followUp] failed for /${cmd}: ${e}`);
    }
  }
});

client.login(process.env.DISCORD_TOKEN)
  .then(() => logger.debug('Login resolved'))
  .catch(e => logger.error(`Login failed: ${e}`));
