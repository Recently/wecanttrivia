// clear-global-commands.js
import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: [] }    // empty array = remove all global commands
  );
  console.log('? Cleared all global commands');
})();
