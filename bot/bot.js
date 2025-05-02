// bot.js
import { Client, GatewayIntentBits } from 'discord.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import winston from 'winston';
import 'winston-daily-rotate-file';

dotenv.config();
const BOT_VERSION = '0.4.1 Alpha';
const DEBUG = process.env.DEBUG_LOGGING === 'true';

// ─── Logger Setup ─────────────────────────────────────────────────────────────
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

logger.info('Bot starting...');
if (DEBUG) logger.debug('Debug logging ENABLED');

// ─── Discord Client ───────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  logger.info(`Logged in as ${client.user.tag}`);
  logger.info(`Created by Recent - Version ${BOT_VERSION}`);
});

// ─── Command Handlers ─────────────────────────────────────────────────────────
async function handleHelpTrivia(interaction) {
  const content = [
    '**Trivia Bot Help**',
    'Submit questions here: https://wecantread.club/trivia/',
    'If you receive "command not found", try again after a few seconds.',
    '',
    '• First register: `/register rsn:<Your RSN>`',
    '• Then submit: `/submit question:<Your Question> answer:<Correct Answer> [week:<Number>]`'
  ].join('\n');
  await safeEdit(interaction, content);
}

async function handleVersion(interaction) {
  const content = `Trivia Bot version: ${BOT_VERSION}`;
  await safeEdit(interaction, content);
}

async function handlePing(interaction) {
  const interactionTime = interaction.createdTimestamp;
  const now = Date.now();
  const delta = now - interactionTime;
  const userTag = interaction.user?.tag || interaction.user?.id;
  logger.debug(`Ping command received. Interaction created ${delta}ms ago`);

  if (interaction.replied || interaction.deferred) {
    logger.warn(`Ping interaction already replied or deferred | User: ${userTag} | ID: ${interaction.id}`);
    return;
  }

  let reply;
  try {
    reply = await interaction.reply({
      content: 'Pinging...',
      ephemeral: false,
      fetchReply: true
    });
    logger.debug('Ping reply sent successfully.');
  } catch (err) {
    logger.error(`Ping reply failed | User: ${userTag} | ID: ${interaction.id} | ${err.stack || err}`);
    return;
  }

  try {
    const roundTripLatency = reply.createdTimestamp - interactionTime;
    const discordApiLatency = client.ws.ping;
    const response = [
      `Pong! Round-trip latency: ${roundTripLatency}ms`,
      `Discord API latency: ${Math.round(discordApiLatency)}ms`
    ].join('\n');
    await interaction.editReply({ content: response });
    logger.debug(`Ping reply edited: round-trip ${roundTripLatency}ms`);
  } catch (err) {
    logger.error(`Ping editReply failed | User: ${userTag} | ID: ${interaction.id} | ${err.stack || err}`);
  }
}

async function handleRegister(interaction, opts) {
  const rsn = opts.getString('rsn');
  if (!rsn) {
    await safeEdit(interaction, 'You must provide an RSN to register.');
    return;
  }

  try {
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
      ? `Registered as ${rsn}`
      : `Registration failed: ${json.error || 'Unknown error'}`;

    await safeEdit(interaction, content);
  } catch (err) {
    logger.error(`Register fetch error: ${err.stack || err}`);
    await safeEdit(interaction, 'An error occurred while processing your registration.');
  }
}

async function handleSubmit(interaction, opts) {
  const question = opts.getString('question');
  const answer = opts.getString('answer');
  if (!question || !answer) {
    await safeEdit(interaction, 'You must supply both question and answer.');
    return;
  }

  const weekOpt = opts.getInteger('week');
  const payload = {
    discord_id: interaction.user.id,
    question,
    answer,
  };
  if (Number.isInteger(weekOpt)) payload.week_id = weekOpt - 1;

  try {
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
      ? 'Question submitted successfully.'
      : `Submission failed: ${json.error || 'Unknown error'}`;

    await safeEdit(interaction, content);
  } catch (err) {
    logger.error(`Submit fetch error: ${err.stack || err}`);
    await safeEdit(interaction, 'An error occurred while submitting your question.');
  }
}

// ─── Safe Edit Wrapper ────────────────────────────────────────────────────────
async function safeEdit(interaction, content) {
  try {
    await interaction.editReply({ content });
    logger.debug('editReply success: ' + JSON.stringify(content));
  } catch (err) {
    logger.error(`editReply failed | ID: ${interaction.id} | ${err.stack || err}`);
  }
}

// ─── Interaction Router ───────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    try {
      await interaction.reply({ content: 'Unsupported command type.', ephemeral: true });
    } catch (e) {
      logger.error(`Non-command interaction reply failed: ${e.stack || e}`);
    }
    return;
  }

  const cmd = interaction.commandName;
  const opts = interaction.options;
  const interactionTime = interaction.createdTimestamp;
  const delta = Date.now() - interactionTime;
  const userTag = interaction.user?.tag || interaction.user?.id;

  logger.info(`Command: /${cmd} | User: ${userTag} | ID: ${interaction.id} | Age: ${delta}ms | Options: ${JSON.stringify(opts.data)}`);

  try {
    if (cmd === 'ping') {
      await handlePing(interaction);
      return;
    }

    const publicCommands = ['version'];
    const ephemeral = !publicCommands.includes(cmd);

    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: 'Thimkering REALLY Hardly...', ephemeral });
        logger.debug(`Initial reply sent for /${cmd} (ephemeral: ${ephemeral})`);
      } catch (e) {
        logger.error(`Failed to send initial reply for /${cmd} | User: ${userTag} | ID: ${interaction.id} | Error: ${e.stack || e}`);
        return;
      }
    } else {
      logger.warn(`Skipped initial reply for /${cmd} — already replied or deferred | User: ${userTag} | ID: ${interaction.id}`);
      return;
    }

    switch (cmd) {
      case 'helptrivia':
        await handleHelpTrivia(interaction);
        break;
      case 'version':
        await handleVersion(interaction);
        break;
      case 'register':
        await handleRegister(interaction, opts);
        break;
      case 'submit':
        await handleSubmit(interaction, opts);
        break;
      default:
        await safeEdit(interaction, 'Unknown command.');
    }
  } catch (err) {
    logger.error(`Unhandled error in /${cmd} | ID: ${interaction.id} | ${err.stack || err}`);
    await safeEdit(interaction, 'An unexpected error occurred.');
  }
});

// ─── Bot Login ────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN)
  .then(() => logger.info('Login successful.'))
  .catch(e => logger.error(`Login failed: ${e.stack || e}`));
