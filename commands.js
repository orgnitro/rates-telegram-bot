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

// Database creation  

function addToDatabase(data) {
  const db = new sqlite3.Database('./rates.db', (err) => {
    if (err) {
      return console.log(`Error occured while opening database ${err.message}`);
    }
    console.log('Connected to the SQLite database');
  });

  // Adding data from http request to the database

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
  db.close((err) => {
    if (err) {
      return console.log(`Error occured while closing database ${err.message}`);
    }
  });
}

// Commands 

module.exports = {
  start: (ctx) => { ctx.reply('Hello, how can I help You?') },

  help: (ctx) => { ctx.reply('Help') },

  list: (ctx) => {
    const db = new sqlite3.Database('./rates.db', (err) => {
      if (err) { return console.log(err.message) };
    });
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
        db.close()
        return ctx.reply(res);
      })
  },


  exchange: (ctx) => {
    const db = new sqlite3.Database('./rates.db', err => {
      if (err) { console.log(err.message) };
    });

    let [amount, curr1, to, curr2] = ctx.state.command.splitArgs;
    if (isNaN(+amount) || !curr1 || !to || !curr2) {
      return ctx.reply('Please enter in format: /exchange x currency1 to currency2');
    }
    if (to.toUpperCase() !== 'TO') {
      return ctx.reply('Please enter in format: /exchange x currency1 to currency2')
    }
    curr1 = curr1.toUpperCase();
    curr2 = curr2.toUpperCase();

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
    let [currency] = ctx.state.command.splitArgs;
    currency = currency.toUpperCase();
    const date = new Date();
    const from = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate() - 8}`;
    const to = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

    const request = await fetch(`https://api.exchangeratesapi.io/history?start_at=${from}&end_at=${to}&base=USD&symbols=${currency}`);
    const response = await request.json();
    let responseArray = [];
    for (let key in response.rates) {
      responseArray.push([key, response.rates[key][currency].toFixed(2)])
    };
    let sortedData = responseArray.sort((a, b) => {
      return +a[0].slice(-2) - +b[0].slice(-2);
    });

    let labels = [];
    let data = [];

    sortedData.forEach(value => {
      labels.push(value[0]);
      data.push(value[1]);
    });

    chart
      .setConfig({
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: `${currency}`,
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
            text: 'Exchange rate for the last week relative to USD',
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

    const imgUrl = await chart.getUrl();

    return ctx.replyWithPhoto(imgUrl);
  }
}