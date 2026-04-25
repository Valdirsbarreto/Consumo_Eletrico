// Vercel Serverless Function — proxy seguro para a API do Gemini
// A chave GEMINI_KEY fica nas variáveis de ambiente da Vercel (nunca exposta ao browser)

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const GEMINI_KEY = process.env.GEMINI_KEY;
    if (!GEMINI_KEY) {
        return res.status(500).json({ error: 'GEMINI_KEY not configured in environment variables' });
    }

    try {
        const { model = 'gemini-2.5-flash', body } = req.body;
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;

        const geminiRes = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await geminiRes.json();

        if (!geminiRes.ok) {
            return res.status(geminiRes.status).json(data);
        }

        return res.status(200).json(data);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
