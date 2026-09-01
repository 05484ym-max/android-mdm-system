# פריסה

מומלץ לפרוס את Device Lab כשירות נפרד מה-backend הקיים.

## משתנים
- `LAB_DATABASE_URL` - DB נפרד ל-Device Lab.
- `LAB_ADMIN_KEY` - מפתח גישה חזק.
- `MDM_DATABASE_URL` - אופציונלי, משתמש DB read-only בלבד.
- `MDM_DATABASE_SSL` / `LAB_DATABASE_SSL`.

## Render
Root Directory: `device-lab`
Build Command: `npm install`
Start Command: `npm start`

אין לשתף credentials בין Device Lab ל-MDM. ל-`MDM_DATABASE_URL` מומלץ role עם SELECT בלבד.

## לפני production
1. החלף LAB_ADMIN_KEY.
2. HTTPS בלבד.
3. DB נפרד.
4. אל תאשר Flash Profile ללא evidence ובדיקת מכשיר אמיתי.
