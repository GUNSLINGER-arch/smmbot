const { exec } = require('child_process');
const path = require('path');

const url = "https://www.tiktok.com/@sawased146/video/7661755647154785557";
const platform = "TikTok";
const scraperPath = path.join(__dirname, '..', 'scraper.py');

exec(`python "${scraperPath}" "${url}" "${platform}"`, { timeout: 25000 }, (error, stdout, stderr) => {
  console.log("=== STDOUT ===");
  console.log(JSON.stringify(stdout));
  console.log("=== STDERR ===");
  console.log(JSON.stringify(stderr));
  try {
    const parsed = JSON.parse(stdout.trim());
    console.log("=== PARSED SUCCESS ===");
    console.log(parsed);
  } catch (e) {
    console.log("=== PARSE ERROR ===");
    console.log(e.message);
  }
});
