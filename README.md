# KSP — חיפוש ומבצעים

## אתר חי

**https://ymtzioni.github.io/ksp-mcp/**

## למה נדרש שרת API (פעם אחת)

KSP חוסם קריאות ישירות מהדפדפן ומפרוקסי ציבוריים. האתר משתמש ב-**Cloudflare Worker** קטן שמעביר בקשות ל-KSP.

### פריסת ה-API (מפתח — פעם אחת)

1. צור [Cloudflare API Token](https://dash.cloudflare.com/profile/api-tokens) עם הרשאת Workers.
2. ב-GitHub repo → **Settings → Secrets and variables → Actions**:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. הרץ workflow **Deploy KSP API Proxy** (או `npm run deploy:api` מקומית).
4. העתק את כתובת ה-Worker (למשל `https://ksp-api-proxy.YMTzioni.workers.dev`).
5. **Settings → Variables → Actions** → `KSP_API_PROXY` = הכתובת.
6. דחוף שינוי או הרץ מחדש **Deploy GitHub Pages**.

אחרי זה החיפוש והסריקה יעבדו באתר החי.
