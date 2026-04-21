module.exports = async function handler(req, res) {
    // 1. הגדרות CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) return res.status(500).json({ error: 'מפתח API חסר בהגדרות השרת' });

	const configurations = [
    	{ name: "gemini-2.0-flash", version: "v1beta" }, // חייב v1beta עבור המודלים החדשים
    	{ name: "gemini-2.5-flash", version: "v1beta" }, 
    	{ name: "gemini-1.5-flash", version: "v1" }      // יכול לעבוד בשניהם, v1 יציב יותר
	];

    let lastError = null;

    try {
        // 3. לולאת ניסיונות
        for (const config of configurations) {
            try {
                // שינוי 1: הפנייה לנתיב של streamGenerateContent עם alt=sse
                const url = `https://generativelanguage.googleapis.com/${config.version}/models/${config.name}:streamGenerateContent?key=${apiKey}&alt=sse`;
                
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(req.body)
                });

                // אם הבקשה נכשלה (למשל 429 או 503), נשמור שגיאה ונמשיך למודל הבא
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    lastError = errorData.error || { message: `Status ${response.status}` };
                    console.warn(`Model ${config.name} failed, trying next... Reason:`, lastError.message);
                    continue; 
                }

                // שינוי 2: מגדירים ל-Vercel לשדר נתונים בזרם (Streaming) ללקוח
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                console.log(`Streaming success with: ${config.name}`);

                // שינוי 3: קוראים את הזרם שמגיע מגוגל וכותבים אותו מיד החוצה ללקוח
                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break; // אם סיימנו, יוצאים מהלולאה
                    
                    // מפענחים את החתיכה (chunk) וכותבים אותה ב-Response
                    const chunk = decoder.decode(value, { stream: true });
                    res.write(chunk); 
                }

                res.end(); // מסיימים את החיבור באופן רשמי
                return;    // יוצאים לחלוטין מהפונקציה, הכל עבד!

            } catch (err) {
                console.error(`Network error with ${config.name}:`, err);
                lastError = err;
            }
        }

        // 4. אם הגענו לכאן, כל המודלים נכשלו (מחזירים שגיאת JSON רגילה)
        return res.status(503).json({
            error: "כל המודלים עמוסים כרגע",
            details: lastError
        });

    } catch (criticalError) {
        return res.status(500).json({ error: 'שגיאה קריטית בשרת' });
    }
}
