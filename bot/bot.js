// bot.js
import { Client, GatewayIntentBits } from 'discord.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();
const BOT_VERSION = '0.3.7 Alpha';
const DEBUG = process.env.DEBUG_LOGGING === 'true';

console.log('Bot starting...');
if (DEBUG) console.log('Debug logging ENABLED');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Created by Recent - Version ${BOT_VERSION}`);
});

// Command handlers
async function handleHelpTrivia(interaction) {
  const content = [
    '**Trivia Bot Help**',
    'Submit questions here: https://wecantread.club/trivia/',
    'If you receive "command not found", try again after a few seconds.',
    '',
    '• First register: `/register rsn:<Your RSN>`',
    '• Then submit: `/submit question:<Your Question> answer:<Correct Answer> [week:<Number>]`'
  ].join('\n');
  await interaction.editReply({ content });
}

async function handleVersion(interaction) {
  const content = `Trivia Bot version: ${BOT_VERSION}`;
  await interaction.editReply({ content });
}

async function handlePing(interaction) {
  const reply = await interaction.reply({
    content: 'Pinging...',
    ephemeral: false,
    fetchReply: true
  });

  const roundTripLatency = reply.createdTimestamp - interaction.createdTimestamp;
  const discordApiLatency = client.ws.ping;

  const response = [
    `Pong! Round-trip latency: ${roundTripLatency}ms`,
    `Discord API latency: ${Math.round(discordApiLatency)}ms`
  ].join('\n');

  await interaction.editReply({ content: response });
}

async function handleRegister(interaction, opts) {
  const rsn = opts.getString('rsn');
  if (!rsn) {
    await interaction.editReply({ content: 'You must provide an RSN to register.' });
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
  console.log(`Register response: ${res.status} | ${JSON.stringify(json)}`);

  const content = res.ok && !json.error
    ? `Registered as ${rsn}`
    : `Registration failed: ${json.error || 'Unknown error'}`;

  await interaction.editReply({ content });
}

async function handleSubmit(interaction, opts) {
  const question = opts.getString('question');
  const answer = opts.getString('answer');
  if (!question || !answer) {
    await interaction.editReply({ content: 'You must supply both question and answer.' });
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
  console.log(`Submit response: ${res.status} | ${JSON.stringify(json)}`);

  const content = res.ok && !json.error
    ? 'Question submitted successfully.'
    : `Submission failed: ${json.error || 'Unknown error'}`;

  await interaction.editReply({ content });
}

// Main handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    try {
      await interaction.reply({ content: 'Unsupported command type.', ephemeral: true });
    } catch (e) {
      console.error(`Failed to reply to non-chat input: ${e}`);
    }
    return;
  }

  const cmd = interaction.commandName;
  const opts = interaction.options;
  console.log(`Command: /${cmd} | Options: ${JSON.stringify(opts.data)}`);

  try {
    // Special handling for ping (non-ephemeral)
    if (cmd === 'ping') {
      await handlePing(interaction);
      return;
    }

    // Decide if the response should be public or ephemeral
    const publicCommands = ['version'];
    const ephemeral = !publicCommands.includes(cmd);

    await interaction.reply({ content: 'Processing...', ephemeral });

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
        await interaction.editReply({ content: 'Unknown command.' });
    }
  } catch (err) {
    console.error(`Error handling /${cmd}: ${err}`);
    try {
      await interaction.editReply({ content: 'An unexpected error occurred.' });
    } catch (e) {
      console.error(`Failed to edit reply: ${e}`);
    }
  }
});

// Login
client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log('Login successful.'))
  .catch(e => console.error(`Login failed: ${e}`));
