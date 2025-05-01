// deploy-commands.js
import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const commands = [
  new SlashCommandBuilder()
    .setName('helptrivia')
    .setDescription('Get help on our Trivia Submissions bot — or submit manually at https://wecantread.club/trivia/'),

  new SlashCommandBuilder()
    .setName('register')
    .setDescription('Link your Discord account to your RSN')
    .addStringOption(opt =>
      opt.setName('rsn')
         .setDescription('Your RuneScape name')
         .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('submit')
    .setDescription('Submit a trivia question')
    .addStringOption(opt =>
      opt.setName('question')
         .setDescription('Your trivia question')
         .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('answer')
         .setDescription('Your CORRECT answer')
         .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('week')
         .setDescription('Trivia week number (Base 1, optional)')
         .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('version')
    .setDescription('Check the current bot version'),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Ping the bot to check latency'),

].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Deploying slash commands…');
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );
    console.log('Deployed slash commands');
  } catch (err) {
    console.error('Failed to deploy slash commands:', err);
  }
})();
