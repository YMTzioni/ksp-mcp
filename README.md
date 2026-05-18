# KSP — חיפוש ומבצעים

אתר לחיפוש מוצרים, ציד מבצעים (יניב), תחקור מחירים והשוואה — מבוסס על [KSP.co.il](https://ksp.co.il).

## אתר חי

**https://ymtzioni.github.io/ksp-mcp/**

## יכולות

- **חיפוש** — מוצרים עם סינון, מיון ותצוגת כרטיסים/טבלה
- **יניב** — סריקה אוטומטית של מציאונים, חיסול מלאי, outlet ועוד
- **תחקור** — מדרג מחירים, חיסכון, מוצרים דומים
- **השוואה** — עד 5 מוצרים במקביל
- **ייצוא CSV** — תוצאות סריקת יניב

## הרצה מקומית

```powershell
cd E:\ksp-mcp
npm install
npm run dev
```

פתח: **http://localhost:3000**

## פריסה ל-GitHub Pages

כל push ל-`main` מפעיל את ה-workflow ומפרסם את תיקיית `public/`.

הגדרה חד-פעמית: **Settings → Pages → Source: GitHub Actions**

## מבנה הפרויקט

```
public/
  index.html      # דף ראשי
  js/ksp-core.js  # לוגיקה + קריאות ל-API של KSP
  js/app.js       # ממשק משתמש
  css/            # עיצוב
```

## הערות

- האתר רץ בדפדפן; קריאות ל-KSP עוברות דרך proxy (CORS).
- אין קשר רשמי ל-KSP — לשימוש אישי בלבד.
