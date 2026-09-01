# ארכיטקטורת Device Lab

## מבנה
```
[Termux / Windows Scanner]
          |
          v
[Device Lab API] ---> [Compatibility DB]
          |                  |
          |                  +--> Hardware Families
          |                  +--> Firmware Builds
          |                  +--> Flash Profiles
          |                  +--> MDM Compatibility Profiles
          |
          +---- read-only ---> [Existing MDM DB]
```

המערכת החדשה מבודדת ב-`device-lab/`. אין שינוי בקבצי ה-MDM הקיימים.

## Workflow
CONNECT -> IDENTIFY -> COLLECT -> NORMALIZE -> FAMILY MATCH -> ROM MATCH ->
MDM COMPATIBILITY -> DECISION

סטטוסים:
- SUPPORTED_NO_FLASH
- SUPPORTED_NEEDS_PROVISIONING
- SUPPORTED_NEEDS_FLASH
- UNKNOWN_BUILD
- FLASH_BLOCKED
- UNSUPPORTED

## בטיחות צריבה
V1 לא צורב אוטומטית. הוראות מוצגות רק כאשר:
1. confidence הוא HIGH.
2. Flash Profile הוא APPROVED.
3. family/build/variant תואמים.
4. target firmware וכלי נדרשים מוגדרים.
5. anti-rollback ידוע.
6. כל image כולל SHA-256.
7. דרישות unlock/OEM authorization מתועדות ומאושרות.

אחרת התוצאה היא "לא לצרוב כרגע".

## סנכרון עם MDM
- `MDM_DATABASE_URL` הוא חיבור read-only מומלץ ל-DB הקיים.
- Device Lab מציג את מכשירי ה-MDM ויכול לקשר Scan ל-deviceId.
- Compatibility Profile נשמר ב-Device Lab ונקשר למשפחת חומרה.
- אין כתיבה ישירה ל-policy או לטבלאות production של ה-MDM.
- Integration write-back עתידי יתבצע רק דרך API חתום ייעודי לאחר אישור.

כך נשמר סנכרון זיהוי/קישור מלא בלי לסכן את המערכת הקיימת.

## Scanner
הסורק מבצע רק קריאות:
- ADB getprop
- dpm list owners
- package resolve ל-SetupWizard
- fastboot getvar
- lsusb אם זמין

אין wipe, unlock, flash, reboot או שינוי הגדרות.

## תמיכה עתידית ב-Windows
Bridge נפרד יוכל לדווח:
- דרייברים מותקנים/חסרים
- כלי OEM וגרסה
- USB modes
- הרשאות OEM
- קבצי firmware/checksum

גם שם פעולת flash תישאר gated על Flash Profile מאושר.

## ⚠ שינוי אלגוריתם familyFingerprint (audit fix)
`familyFingerprint` חושב במקור מ-`device|board|hardware|platform|fastbootProduct`.
`fastbootProduct` תלוי-מצב-חיבור (קיים רק אם המכשיר נסרק במצב fastboot), ולכן אותה חומרה
פיזית יכלה לקבל fingerprint שונה בין סריקות — תוקן להוציא אותו מהחישוב; הנוסחה הנוכחית
היא `device|board|hardware|platform` בלבד.

**השפעה על נתונים ישנים:** כל `lab_hardware_families` ו-`lab_flash_profiles` שנוצרו לפני
התיקון (בכל סביבה שבה כבר רץ scan אמיתי, לא רק בבדיקות עם payload סינתטי) מחזיקים
fingerprint שחושב עם הנוסחה הישנה. סריקה חדשה של אותה חומרה תחשב fingerprint לפי הנוסחה
החדשה ולא תתאים אוטומטית למשפחה/פרופיל הישן. **יש להריץ reclassify מחדש** (ולבחון promote-family
מחדש במידת הצורך) לכל משפחה/פרופיל production שנוצר לפני התיקון הזה, לפני הסתמכות עליו.
