const axios = require('axios');

async function testForexFactory() {
  try {
    const res = await axios.get('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
    console.log(JSON.stringify(res.data.slice(0, 5), null, 2));
  } catch (e) {
    console.error(e.response ? e.response.data : e.message);
  }
}
testForexFactory();
