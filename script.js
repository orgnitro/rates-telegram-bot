if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const { Telegraf } = require('telegraf');
const commands = require('./commands');
const commandParts = require('./commandParts');
const app = express();
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const URL = process.env.URL || 'https://rates-telegram-bot.herokuapp.com';
const bot = new Telegraf(BOT_TOKEN);

bot.telegram.setWebhook(`${URL}/bot${BOT_TOKEN}`);
app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));

bot.use(commandParts);

//  Commands

bot.start((ctx) => commands.start(ctx));
bot.help((ctx) => commands.help(ctx));
bot.command('list', (ctx) => {
  commands.list(ctx);
});
bot.command('exchange', (ctx) => {
  commands.exchange(ctx);
});
bot.command('history', async (ctx) => {
  await commands.history(ctx);
});

// Creates blank table inside database file

const db = new sqlite3.Database('./rates.db', (err) => {
  if (err) {
    return console.log(`Error occured while opening database ${err.message}`);
  }
})

db.run(`CREATE TABLE IF NOT EXISTS rates(
  currency TEXT UNIQUE, 
  rate REAL UNIQUE,
  lastRequest INTEGER UNIQUE
  )`);

db.close((err) => {
  if (err) {
    return console.log(`Error occured while closing database ${err.message}`);
  }
});

// Server creation

bot.launch();

app.get('/', (req, res) => res.send('The bot was started. Find @exchange_orgnitro_bot in Telegram'))

app.listen(PORT, () => {
  console.log('Server started at port 3000');
});