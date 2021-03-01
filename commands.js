const fetch = require('node-fetch');
const sqlite3 = require('sqlite3').verbose();
const QuickChart = require('quickchart-js');
let currentRates = {};

async function fetchRatesWithBaseUSD() {
  const request = await fetch('https://api.exchangeratesapi.io/latest?base=USD');
  const data = await request.json();
  addToDatabase(data);
  return data;
}

function openDB() {
  const db = new sqlite3.Database('./rates.db', (err) => {
    if (err) {
      return console.log(`Error occured while opening database ${err.message}`);
    }
  })
  console.log('db opened')
  return db
}

function closeDB(db) {
  db.close((err) => {
    if (err) {
      return console.log(`Error occured while closing database ${err.message}`);
    }
  })
  console.log('db closed');
}

function addToDatabase(data) {
  const db = openDB();

  let = stringifiedData = '';
  for (let [currency, rate] of Object.entries(data.rates)) {
    stringifiedData += `('${currency}', ${rate}), `;
  }
  stringifiedData = stringifiedData.slice(0, -2);

  db.serialize(() => {
    db.run(`DELETE FROM rates
            WHERE lastRequest != 0`)
    db.run(`REPLACE INTO rates(currency, rate)
            VALUES ${stringifiedData}`)
    db.run(`INSERT INTO rates(lastRequest)
            VALUES (${Date.now()})`)
  });

  closeDB(db);
}

// Commands 

module.exports = {
  start: function(ctx) { 
    ctx.reply('Hello. How can I help You?\nAll commands are here: /help') },

  help: function(ctx) {
    ctx.reply(`Commands:\n
    /list - Return list of all available currencies and rates. Data is updated every 10 minutes. For more frequent requests shows data from local database\n
    /exchange - Convert money from one currency to another (example: "10 USD to CAD"). Data is updated every 10 minutes.\n
    /history - Show graph with rates history for selected currency during last week (example: "/history CAD to EUR", or "/history RUB"). Rates are not available for weekend days.`)
  },

  list: function(ctx) {
    const db = openDB();
    // Search rates in database 
    new Promise((resolve) => {
      db.get(`
      SELECT lastRequest 
      FROM rates 
      WHERE lastRequest != 0`, (err, row) => resolve(row))
    })
      .then(res => {
        if (!res || (Date.now() - res.lastRequest > 6e5)) {
      // If nothing was found or information is outdated, then make http request 
          return new Promise((resolve) => resolve(fetchRatesWithBaseUSD()))
        }
      })
      .then((serverData) => {
        let response = 'Exchange rate relative to USD:\n\n';
        if (serverData) {
          // Server data handling 
          for (let [currency, rate] of Object.entries(serverData.rates)) {
            response += `${currency}: ${rate.toFixed(2)}\n`
          }
          return response;
        } else {
          // DB data handling 
          return new Promise(resolve => {
            db.all(`
            SELECT currency, rate 
            FROM rates 
            WHERE currency != 0`, (err, row) => {
              row.forEach((item) => {
                response += `${item.currency}: ${item.rate.toFixed(2)}\n`;
              })
              resolve(response)
            })
          })
        }
      })
      .then(res => {
        closeDB(db);
        return ctx.reply(res);
      })
  },

  exchange: function(ctx) {
    let [amount, curr, to, base] = ctx.state.command.splitArgs;
    // Wrong format messages 
    if (isNaN(+amount) || !curr || !to || !base) {
      return ctx.reply('Please enter in format: "/exchange x currency1 to currency2"');
    }
    if (to.toUpperCase() !== 'TO') {
      return ctx.reply('Please enter in format "/exchange x currency1 to currency2"')
    }
    curr = curr.toUpperCase();
    base = base.toUpperCase();

    const db = openDB();
    
    let available = [null, null];
    // Information about currencies availability and rates will be stored in this array 
    new Promise(resolve => {
      // Last request timestamp search 
      db.get(`
      SELECT lastRequest 
      FROM rates 
      WHERE lastRequest != 0`, (err, row) => resolve(row))
    })
      .then((res) => {
        if (!res || (Date.now() - res.lastRequest > 6e5)) {
          // If nothing was found or information are outdated, then make http request 
          return new Promise(resolve => {
            resolve(fetchRatesWithBaseUSD())
          })
        }
      })
      .then((serverData) => {
        if (serverData) {
          // Server data handling 
          for (let [currency, rate] of Object.entries(serverData.rates)) {
            if (currency === curr) {
              available[0] = { currency, rate }
            }
            if (currency === base) {
              available[1] = { currency, rate }
            }
          }
          return available;
        } else {
          // DB data handling 
          return new Promise(resolve => {
            db.all(`SELECT currency, rate 
            FROM rates 
            WHERE currency 
            IN ('${curr}', '${base}')`, (err, row) => {
              row.forEach((item) => {
                if (item.currency === curr) {
                  available[0] = item
                }
                if (item.currency === base) {
                  available[1] = item
                }
              })
              resolve(available);
            })
          })
        }
      })
      .then(res => {
        closeDB(db);
        let errorMsg = '';
        // User will get message if some currency is not available
        if (!res[0]) {
          errorMsg += `${curr} `;
        }
        if (!res[1]) {
          errorMsg += `${base} `
        }
        if (errorMsg) {
          return ctx.reply(`Rates are not available for: ${errorMsg}`)
        } else {
          let result = (amount * res[1].rate / res[0].rate).toFixed(2);
          return ctx.reply(`${amount} ${curr} = ${result} ${base}`)
        }
      })
  },

  history: async (ctx) => {
    const chart = new QuickChart();
    let [curr, to, base] = ctx.state.command.splitArgs;
    if (!curr) {
      // Wrong format message
      return ctx.reply('Please, enter in format "/history currency1 to currency2"')
    }
    if (!base || !to) {
      // Use USD as the base currency, if base was not provided 
      base = 'USD'
    }
    curr = curr.toUpperCase();
    base = base.toUpperCase();
    const fromDate = new Date(Date.now() - 6.048e8).toISOString().replace(/T(.+)/, '');
    const toDate = new Date().toISOString().replace(/T(.+)/, '');
    const request = await fetch(`
      https://api.exchangeratesapi.io/history?start_at=${fromDate}&end_at=${toDate}&base=${base}&symbols=${curr}
      `);
    const response = await request.json();
    if (response.error) {
      return ctx.reply(`Error: ${response.error}`);
    } else {
      let responseArray = [];
      for (let key in response.rates) {
        responseArray.push([key, response.rates[key][curr]])
      };
      let sortedData = responseArray.sort((a, b) => {
        return +a[0].slice(-2) - +b[0].slice(-2);
      });

      let labels = [];
      let data = [];

      sortedData.forEach(value => {
        labels.push(new Date(value[0]).toLocaleString('en-US', {
          day: '2-digit', month: 'short'
        }));
        data.push(value[1].toFixed(2));
      });
      chart
        .setConfig({
          type: 'line',
          data: {
            labels,
            datasets: [{
              label: `${curr}`,
              data,
            }]
          },
          options: {
            legend: {
              labels: {
                fontSize: 10,
                fontStyle: 'bold',
              }
            },
            title: {
              display: true,
              text: `Exchange rate for the last week relative to ${base}`,
              fontSize: 20,
            },
            scales: {
              yAxes: [
                {
                  ticks: {
                    fontFamily: 'Mono',
                  },
                },
              ],
              xAxes: [
                {
                  ticks: {
                    fontFamily: 'Sans-Serif',
                  },
                },
              ],
            },
          },
        })
        .setWidth(600)
        .setHeight(300);

      new Promise(resolve => resolve(chart.getUrl()))
      .then(imgUrl => {
        return ctx.replyWithPhoto(imgUrl);
      })
    }
  }
}