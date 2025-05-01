const { google } = require('googleapis');
const fetch = require('node-fetch');
const fs = require('fs');

// Загружаем креденшлы
const auth = new google.auth.GoogleAuth({
  keyFile: 'credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

// Настройки
const SPREADSHEET_ID = 'your_spreadsheet_id_here';

async function main() {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const sheetList = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const tabs = sheetList.data.sheets.map(s => s.properties.title);

  for (const sheetName of tabs) {
    const tokenResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!B1`,
    });
    const token = tokenResp.data.values?.[0]?.[0];
    if (!token) continue;

    const articulesResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A2:A`
    });
    const articules = articulesResp.data.values || [];

    const results = [];

    for (const [idx, [nmid]] of articules.entries()) {
      if (!nmid) {
        results.push(['', '']);
        continue;
      }

      const url = `https://feedbacks-api.wildberries.ru/api/v1/feedbacks?isAnswered=true&nmId=${nmid}&take=5000&skip=0&order=dateDesc`;

      try {
        const res = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'Authorization': token
          }
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const data = json.data || {};
        const total = (data.countUnanswered || 0) + (data.countArchive || 0);
        const feedbacks = data.feedbacks || [];

        let avg = 0;
        if (feedbacks.length > 0) {
          const sum = feedbacks.reduce((a, b) => a + (b.productValuation || 0), 0);
          avg = +(sum / feedbacks.length).toFixed(2);
        }

        results.push([total, avg]);
      } catch (err) {
        console.error(`Error for nmId ${nmid}:`, err.message);
        results.push(['error', '']);
      }

      await new Promise(resolve => setTimeout(resolve, 1000)); // пауза 1 секунда
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!B2:C${results.length + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: results }
    });
  }
}

main().catch(console.error);
