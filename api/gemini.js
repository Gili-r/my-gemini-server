const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const config = {
    runtime: 'edge', // זה הפתרון האמיתי לקיטועים ב-Vercel!
};

export default async function handler(req) {
    // 1. הגדרות CORS כולל ביטול הבאפרינג
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no' // אומר ל-Vercel לא לעכב את הטקסט בבופר
    };

    if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });
    if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers });

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    // תיקון 1: הוספנו return
    if (!apiKey) return new Response(JSON.stringify({ error: 'מפתח API חסר בהגדרות השרת' }), { status: 500, headers });

	const configurations = [
    	{ name: "gemini-2.5-flash", version: "v1beta" }, 
    	{ name: "gemini-2.5-flash-lite", version: "v1beta" }, 
    	{ name: "gemini-1.5-flash-latest", version: "v1beta" }     
	];

    let lastError = null;
	let body;
	try {
        body = await req.json();
    } catch (error) {
        console.error("Failed to parse request body:", error);
        return new Response(JSON.stringify({ error: 'המידע שנשלח אינו תקין (Invalid JSON)' }), { 
            status: 400, 
            headers: headers 
        });
    }

    try {
        // 3. לולאת ניסיונות
        for (const config of configurations) {
            try {
                const url = `https://generativelanguage.googleapis.com/${config.version}/models/${config.name}:streamGenerateContent?key=${apiKey}&alt=sse`;
                
                const response = await fetch(url, {
                    method: 'POST',
                    // שימי לב שכאן אנחנו צריכים להגדיר שוב Content-Type עבור הבקשה לגוגל, וזה בסדר
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify(body)
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    lastError = errorData.error || { message: `Status ${response.status}` };
                    console.warn(`Model ${config.name} failed, trying next... Reason:`, lastError.message);
    				await sleep(2000);
                    continue; 
                }

                console.log(`Streaming success with: ${config.name}`);

				// תיקון 2: מחקנו את ה-headers הכפול, משתמשים בזה שהוגדר למעלה!
				// מחזירים את הזרם ישירות ללקוח - השרת עושה את הכל מאחורי הקלעים!
				return new Response(response.body, { headers });				

            } catch (err) {
                console.error(`Network error with ${config.name}:`, err);
                lastError = err;
            }
        }

        // תיקון 3: המרת פקודות ה-res הישנות ל-Edge Response
        return new Response(JSON.stringify({
            error: "כל המודלים עמוסים כרגע",
            details: lastError
        }), { status: 503, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

    } catch (criticalError) {
        // תיקון 4: המרה כנ"ל לשגיאת 500
        return new Response(JSON.stringify({ error: 'שגיאה קריטית בשרת' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
}
