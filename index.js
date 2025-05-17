const { google } = require('googleapis');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, 'temp_credentials.json');
fs.writeFileSync(CREDENTIALS_PATH, process.env.GCP_CREDENTIALS);

const auth = new google.auth.GoogleAuth({
  keyFile: CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID; // ссылка на таблицу

async function main() {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetTitles = sheetMeta.data.sheets.map(s => s.properties.title);

  for (const title of sheetTitles) {
    console.log(`Обрабатывается лист: ${title}`);

    const tokenResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${title}!B1`
    });
    const token = tokenResp.data.values?.[0]?.[0] || '';
    if (!token) {
      console.log(`Пропуск листа "${title}" — токен не найден.`);
      continue;
    }

    const nmidResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${title}!A2:A`
    });
    const nmidValues = nmidResp.data.values || [];

    const results = [];

    for (let i = 0; i < nmidValues.length; i++) {
      const nmId = nmidValues[i][0];
      if (!nmId) {
        results.push(['', '']);
        continue;
      }

      const url = `https://feedbacks-api.wildberries.ru/api/v1/feedbacks?isAnswered=true&nmId=${nmId}&take=5000&skip=0&order=dateDesc`;
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Authorization': token
          }
        });

        if (!response.ok) {
          console.warn(`Ошибка ${response.status} для nmId ${nmId}`);
          results.push([`HTTP ${response.status}`, '']);
          await delay(1000);
          continue;
        }

        const json = await response.json();
        const data = json.data || {};
        const total = (data.countUnanswered || 0) + (data.countArchive || 0);
        const feedbacks = Array.isArray(data.feedbacks) ? data.feedbacks : [];

        let avg = '';
        if (feedbacks.length > 0) {
          const sum = feedbacks.reduce((acc, fb) => acc + (fb.productValuation || 0), 0);
          avg = Math.round((sum / feedbacks.length) * 100) / 100;
        }

        results.push([total, avg]);
      } catch (e) {
        console.error(`Ошибка при получении данных для ${nmId}:`, e.message);
        results.push(['Fetch error', '']);
      }

      await delay(1000); // соблюдение лимита 1 запрос/сек
    }

    // Запись результатов обратно в столбцы B и C
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${title}!B2`,
      valueInputOption: 'RAW',
      requestBody: {
        values: results
      }
    });

    console.log(`Обработка листа "${title}" завершена.`);
  }

  fs.unlinkSync(CREDENTIALS_PATH); // удаление временного файла
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
