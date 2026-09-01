# מעבדת מכשירים

מערכת נפרדת בתוך אותו repo לזיהוי, סיווג והכנת מכשירי Android לפני כניסה ל-MDM.

- לא משנה קבצים קיימים של ה-MDM.
- כל סריקה היא read-only.
- אין צריבה אוטומטית ב-V1.
- הוראות צריבה רק לפרופיל APPROVED וב-confidence HIGH.
- אפשר לקשר Scan למכשיר MDM לפי deviceId.
- הסנכרון מול MDM read-only כברירת מחדל.

## הרצה
```bash
cd device-lab
cp .env.example .env
npm install
npm start
```

## סריקה מ-Termux
```bash
LAB_SERVER_URL=https://your-device-lab.example LAB_ADMIN_KEY=... node scanner/scanner.js
```
