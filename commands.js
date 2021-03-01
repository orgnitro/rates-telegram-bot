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
    ctx.reply('Hello. Here you can find actual exchange rates.\nMore details here /help') },

  help: function(ctx) {
    ctx.reply(`Commands:\n
    /list - Return list of all available currencies and rates. Data is updated every 10 minutes. For more frequent requests shows data from local database\n
    /exchange - Convert money from one currency to another (example: "10 USD to CAD"). Data is updated every 10 minutes.\n
    /history - Show graph with rates history for selected currency during last week (example: "/history CAD to EUR", or "/history RUB"). Rates are not available for weekend days.`)
  },

  list: function(ctx) {
    const db = openDB();
    new Promise((resolve) => {
      db.get(`SELECT lastRequest FROM rates WHERE lastRequest != 0`, (err, row) => resolve(row))
    })
      .then(res => {
        if (!res || (Date.now() - res.lastRequest > 6e5)) {
          return new Promise((resolve) => resolve(fetchRatesWithBaseUSD()))
        }
      })
      .then((serverData) => {
        let response = 'Exchange rate relative to USD:\n\n';
        if (serverData) {
          for (let [currency, rate] of Object.entries(serverData.rates)) {
            response += `${currency}: ${rate.toFixed(2)}\n`
          }
          return response;
        } else {
          return new Promise(resolve => {
            db.all(`SELECT currency, rate FROM rates WHERE currency != 0`, (err, row) => {
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
    const [amount, curr1, to, curr2] = ctx.state.command.splitArgs;
    if (isNaN(+amount) || !curr1 || !to || !curr2) {
      return ctx.reply('Please enter in format: /exchange x currency1 to currency2');
    }
    if (to.toUpperCase() !== 'TO') {
      return ctx.reply('Please enter in format: /exchange x currency1 to currency2')
    }
    curr1 = curr1.toUpperCase();
    curr2 = curr2.toUpperCase();

    const db = openDB();

    let available = [null, null];
    new Promise(resolve => {
      db.get(`SELECT lastRequest FROM rates WHERE lastRequest != 0`, (err, row) => resolve(row))
    })
      .then((res) => {
        if (!res || (Date.now() - res.lastRequest > 6e5)) {
          return new Promise(resolve => {
            resolve(fetchRatesWithBaseUSD())
          })
        }
      })
      .then((serverData) => {
        if (serverData) {
          for (let [currency, rate] of Object.entries(serverData.rates)) {
            if (currency === curr1) {
              available[0] = { currency, rate }
            }
            if (currency === curr2) {
              available[1] = { currency, rate }
            }
          }
          return available;
        } else {
          return new Promise(resolve => {
            db.all(`SELECT currency, rate FROM rates WHERE currency IN ('${curr1}', '${curr2}')`, (err, row) => {
              row.forEach((item) => {
                if (item.currency === curr1) {
                  available[0] = item
                }
                if (item.currency === curr2) {
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
        if (!res[0]) {
          errorMsg += `${curr1} `;
        }
        if (!res[1]) {
          errorMsg += `${curr2} `
        }
        if (errorMsg) {
          return ctx.reply(`Rates are not available for: ${errorMsg}`)
        } else {
          let result = (amount * res[1].rate / res[0].rate).toFixed(2);
          return ctx.reply(`${amount} ${curr1} = ${result} ${curr2}`)
        }
      })
  },

  history: async (ctx) => {
    const chart = new QuickChart();
    let [curr1, to, curr2] = ctx.state.command.splitArgs;
    if (!curr2 || !to) {
      curr2 = 'USD'
    }
    curr1 = curr1.toUpperCase();
    curr2 = curr2.toUpperCase();
    const fromDate = new Date(Date.now() - 6.048e8).toISOString().replace(/T(.+)/, '');
    const toDate = new Date().toISOString().replace(/T(.+)/, '');
    const request = await fetch(`
      https://api.exchangeratesapi.io/history?start_at=${fromDate}&end_at=${toDate}&base=${curr2}&symbols=${curr1}
      `);
    const response = await request.json();
    if (response.error) {
      return ctx.reply(`Error: ${response.error}`);
    } else {
      let responseArray = [];
      for (let key in response.rates) {
        responseArray.push([key, response.rates[key][curr1]])
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
              label: `${curr1}`,
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
              text: `Exchange rate for the last week relative to ${curr2}`,
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