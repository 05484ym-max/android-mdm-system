const fs = require('fs');
const assert = require('assert');
const read = p => fs.readFileSync(p, 'utf8');

const index = read('index.js');
const db = read('db.js');
const admin = read('../admin-panel/news.js');
const html = read('../admin-panel/index.html');
const api = read('../dpc-app/app/src/main/java/org/mdmopen/dpc/ApiClient.kt');
const config = read('../dpc-app/app/src/main/java/org/mdmopen/dpc/Config.kt');
const activity = read('../dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt');

assert(index.includes('NEWS_BUBBLE_WIDTH_MIN = 55'));
assert(index.includes('NEWS_BUBBLE_WIDTH_MAX = 100'));
assert(index.includes('patch.bubbleWidthPercent = bubbleWidthPercent'));
assert(db.includes('bubble_width_percent INTEGER NOT NULL DEFAULT 88'));
assert(db.includes("['bubbleWidthPercent', 'bubble_width_percent']"));
assert(html.includes('id="newsBubbleWidthInput"'));
assert(html.includes('id="newsBubbleWidthNumber"'));
assert(admin.includes("form.append('bubbleWidthPercent'"));
assert(api.includes('val bubbleWidthPercent: Int = 88'));
assert(config.includes('.put("bubbleWidthPercent", item.bubbleWidthPercent)'));
assert(activity.includes('newsBubbleLayoutParams(item'));
assert(activity.includes('percent = item.bubbleWidthPercent.coerceIn(55, 100)'));
console.log('news bubble width wiring: ok');
