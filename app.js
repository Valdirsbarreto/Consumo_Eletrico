/* ============================================================
   App Consumo Elétrico — app.js  v3
   Câmera · Leitura Anterior · Datas · Consumo Esperado
   Histórico Editável · Gráfico · Calculadora
   ============================================================ */

'use strict';

// ─────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────
const SK_READINGS = 'consumo_readings';
const SK_APPLIANCES = 'consumo_appliances';
const SK_TARIFF = 'consumo_tariff';
const MULT = 10;
let currentHistoryFilter = 'all'; // 'all' | 'conta' | 'relogio'

let chartInstance = null;
let deferredInstall = null;

// ─────────────────────────────────────────────────────────────
//  UTILITY
// ─────────────────────────────────────────────────────────────
const db = {
    get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
};

function showToast(msg, err = false) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.style.background = err ? 'rgba(255,71,87,0.15)' : 'rgba(0,230,118,0.15)';
    t.style.borderColor = err ? 'rgba(255,71,87,0.4)' : 'rgba(0,230,118,0.4)';
    t.style.color = err ? '#ff4757' : '#00e676';
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
}

function fmtDate(str) {
    if (!str) return '–';
    const d = str.includes('T') ? new Date(str) : new Date(str + 'T12:00:00');
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function toInput(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function daysBetween(a, b) {
    const parse = s => s.includes('T') ? new Date(s) : new Date(s + 'T12:00:00');
    return Math.round(Math.abs(parse(b) - parse(a)) / 86400000);
}

function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────
//  TABS
// ─────────────────────────────────────────────────────────────
function initTabs() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            tab.classList.add('active');
            const sec = document.getElementById('sec' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1));
            if (sec) sec.classList.add('active');
            if (tab.dataset.tab === 'grafico') renderChart();
        });
    });
}

// (photo/OCR features removed — manual input only)


/* OCR/AI code removed */





// Funções de crop removidas

async function analyzeWithOCR() {
    const imgEl = document.getElementById('photoPreview');
    const btn = document.getElementById('btnAnalyze');
    const status = document.getElementById('ocrStatus');

    // ── API Keys: config.js (local) > localStorage > vazio ──
    const cfg = (typeof APP_CONFIG !== 'undefined') ? APP_CONFIG : {};
    const GEMINI_KEY = localStorage.getItem('gemini_api_key') || cfg.GEMINI_KEY || '';
    const OPENAI_KEY = localStorage.getItem('openai_api_key') || cfg.OPENAI_KEY || '';

    if (!imgEl.src || imgEl.src === window.location.href) {
        showToast('⚠️ Tire ou importe uma foto primeiro.', true); return;
    }

    // ── UI: loading state ──
    btn.disabled = true;
    btn.classList.add('loading');
    document.getElementById('analyzeIcon').textContent = '⏳';
    document.getElementById('analyzeLabel').textContent = ' Analisando com IA...';
    status.className = 'ocr-status';
    status.textContent = 'Preparando imagem…';

    try {
        // ── Get image as base64 (with optional crop) ──
        const natW = imgEl.naturalWidth;
        const natH = imgEl.naturalHeight;
        let sx = 0, sy = 0, sw = natW, sh = natH;
        if (cropRect) {
            sx = Math.round(cropRect.x * natW);
            sy = Math.round(cropRect.y * natH);
            sw = Math.round(cropRect.w * natW);
            sh = Math.round(cropRect.h * natH);
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const maxW = 800;
        const scale = Math.min(1, maxW / sw);
        canvas.width = Math.round(sw * scale);
        canvas.height = Math.round(sh * scale);
        ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64 = dataUrl.split(',')[1];

        // ── Build prompt ──
        const prompt = `Você é um especialista em leitura de medidores de energia elétrica analógicos com ponteiros (relógios).

Esta imagem mostra um medidor elétrico analógico com 4 mostradores circulares, cada um com números de 0 a 9 e um ponteiro.

REGRAS DE LEITURA:
1. Leia os mostradores da ESQUERDA para a DIREITA: Milhar, Centena, Dezena, Unidade.
2. Os mostradores ALTERNAM a direção: o 1º gira anti-horário, o 2º horário, o 3º anti-horário, o 4º horário.
3. Quando o ponteiro está ENTRE dois números, leia o MENOR dos dois.
4. Se o ponteiro parece estar exatamente sobre um número, verifique o mostrador à DIREITA:
   - Se o ponteiro do próximo passou de 0, o número é exato.
   - Se não passou de 0, use o número anterior (um a menos).

Responda APENAS com exatamente 4 dígitos numéricos representando a leitura. Nada mais. Exemplo: 3769`;

        // ── Try Gemini first, fallback to OpenAI ──
        let aiText = '';
        let provider = '';

        // Provider 1: Gemini
        try {
            status.textContent = 'Tentando Gemini…';
            const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
            const gRes = await fetch(gUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: prompt },
                            { inlineData: { mimeType: 'image/jpeg', data: base64 } }
                        ]
                    }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 20 }
                })
            });
            if (!gRes.ok) throw new Error(await gRes.text());
            const gJson = await gRes.json();
            aiText = gJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            provider = 'Gemini';
        } catch (geminiErr) {
            console.warn('Gemini failed, trying OpenAI…', geminiErr.message);

            // Provider 2: OpenAI fallback
            status.textContent = 'Gemini indisponível, tentando OpenAI…';
            const oRes = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_KEY}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [{
                        role: 'user', content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
                        ]
                    }],
                    temperature: 0.1,
                    max_tokens: 20
                })
            });
            if (!oRes.ok) {
                const err = await oRes.json().catch(() => ({}));
                throw new Error(`Ambos provedores falharam. OpenAI: ${err?.error?.message || oRes.statusText}`);
            }
            const oJson = await oRes.json();
            aiText = oJson?.choices?.[0]?.message?.content || '';
            provider = 'OpenAI';
        }

        const digits = aiText.replace(/\D/g, '');

        // ── Extract 4 digits ──
        let best = null;
        if (digits.length === 4) {
            best = digits;
        } else if (digits.length > 4) {
            // Take first 4-digit group
            const m = digits.match(/\d{4}/);
            best = m ? m[0] : digits.slice(0, 4);
        }

        if (best && best.length === 4) {
            const d = best.split('');
            ['d0', 'd1', 'd2', 'd3'].forEach((id, i) => {
                document.getElementById(id).value = d[i];
            });
            updatePreview();
            status.className = 'ocr-status ok';
            status.textContent = `✅ Leitura ${provider}: ${best} — Confira e corrija se necessário.`;
            showToast('🤖 Ponteiros lidos com IA! Verifique.');
        } else {
            status.className = 'ocr-status err';
            status.textContent = `❌ IA retornou "${text.trim()}" — não conseguiu identificar 4 dígitos. Tente outra foto.`;
        }

    } catch (err) {
        console.error('Gemini Vision error:', err);
        status.className = 'ocr-status err';
        status.textContent = `❌ ${err.message}`;
    } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
        document.getElementById('analyzeIcon').textContent = '🤖';
        document.getElementById('analyzeLabel').textContent = ' Ler ponteiros com IA';
    }
}

// ─────────────────────────────────────────────────────────────
//  CAMERA LEITURA WITH GEMINI
// ─────────────────────────────────────────────────────────────
function initCameraLeitura() {
    let pendingAiDigits = '';

    const handleFile = async (fileInputId, btnId) => {
        const fileInput = document.getElementById(fileInputId);
        if (!fileInput) return;

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const useProxy = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
            let GEMINI_KEY = (typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.GEMINI_KEY : null) || localStorage.getItem('GEMINI_KEY');
            if (!GEMINI_KEY && !useProxy) {
                document.getElementById('apiKeyCard').style.display = 'block';
                showToast('⚠️ Cole sua chave do Gemini primeiro.', true);
                fileInput.value = '';
                return;
            }

            const photoPreviewImg = document.getElementById('photoPreviewImg');
            const aiStatus = document.getElementById('aiStatus');
            const aiResultBox = document.getElementById('aiResultBox');
            const btn = document.getElementById(btnId);
            
            const originalText = btn.textContent;
            btn.textContent = '⏳ Lendo...';
            btn.disabled = true;
            aiStatus.textContent = '🤖 Analisando os 4 mostradores...';
            aiResultBox.style.display = 'none';
            pendingAiDigits = '';

            try {
                // Comprimir imagem antes de enviar (evita 413 no proxy Vercel)
                const { base64Data, mimeType } = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const img = new Image();
                        img.onload = () => {
                            const MAX = 1600;
                            let w = img.width, h = img.height;
                            if (w > MAX || h > MAX) {
                                if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                                else { w = Math.round(w * MAX / h); h = MAX; }
                            }
                            const canvas = document.createElement('canvas');
                            canvas.width = w; canvas.height = h;
                            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                            const dataUrl = canvas.toDataURL('image/jpeg', 0.80);
                            resolve({ base64Data: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
                        };
                        img.src = ev.target.result;
                    };
                    reader.readAsDataURL(file);
                });

                // Show preview
                photoPreviewImg.src = 'data:' + mimeType + ';base64,' + base64Data;
                photoPreviewImg.style.display = 'block';

                const readings = db.get(SK_READINGS) || [];
                const lastRaw = readings.length > 0 ? readings[readings.length - 1].raw : null;
                const contextText = lastRaw 
                    ? `\n\nCONTEXTO: A leitura anterior foi ${lastRaw}. A nova leitura DEVE ser maior ou igual a ${lastRaw}. Use isso para validar.` 
                    : '';

                // Few-shot dinâmico: inclui a última correção salva pelo usuário
                const lastCorrection = db.get('ai_last_correction');
                const correctionHint = lastCorrection
                    ? `\n\nPREVIOUS CORRECTION: Last time you predicted ${lastCorrection.predicted} but the correct reading was ${lastCorrection.correct}. Pay special attention to pointers ${lastCorrection.wrongDigits.join(' and ')}.`
                    : '';

                const prompt = `You are an expert at reading analog kWh energy meters (Nansen model).

Here is an example of a correct reading for this meter type:
- Pointer 1 (Thousands): Between 3 and 4 → Result 3
- Pointer 2 (Hundreds): Between 8 and 9 → Result 8
- Pointer 3 (Tens): Between 8 and 9 → Result 8
- Pointer 4 (Units): Between 1 and 2 → Result 1
Final reading: 3881.
${correctionHint}
Now extract the reading from the new image. The 4 dials are below "kWh", read left to right. Dials alternate rotation direction.${contextText}

Return ONLY valid JSON with no markdown: {"leitura_nominal": "XXXX", "fator": 10, "leitura_final_kwh": 0}`;

                const geminiBody = {
                    contents: [{
                        parts: [
                            { text: prompt },
                            { inline_data: { mime_type: mimeType, data: base64Data } }
                        ]
                    }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
                };

                let res;
                if (useProxy) {
                    res = await fetch('/api/gemini', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ model: 'gemini-2.5-flash', body: geminiBody })
                    });
                } else {
                    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(geminiBody)
                    });
                }

                if (!res.ok) {
                    const errText = await res.text();
                    console.error("Erro da API Gemini:", errText);
                    throw new Error(`[${res.status}] Detalhe: ${errText}`);
                }
                const data = await res.json();
                
                // Gemini 2.5 pode retornar múltiplas parts (thinking + resposta)
                const parts = data?.candidates?.[0]?.content?.parts || [];
                let aiText = '';
                for (const p of parts) {
                    if (p.text && !p.thought) aiText += p.text;
                }
                if (!aiText) aiText = parts.map(p => p.text || '').join('');
                
                console.log('Resposta bruta da IA:', aiText);
                
                let jsonRet;
                try {
                    // Limpar markdown e extrair JSON
                    let cleaned = aiText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                    // Tentar encontrar o JSON no texto
                    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
                    if (jsonMatch) cleaned = jsonMatch[0];
                    jsonRet = JSON.parse(cleaned);
                } catch(e) {
                    console.error('Texto da IA não parseável:', aiText);
                    throw new Error('Falha ao processar o JSON retornado pela IA.');
                }

                let best = String(jsonRet.leitura_nominal || '');
                best = best.replace(/\D/g, '');
                if (best.length > 4) best = best.slice(0, 4);

                if (best && best.length === 4) {
                    aiStatus.textContent = '✅ Sucesso!';
                    // Preenche os 4 inputs editáveis
                    ['cam0','cam1','cam2','cam3'].forEach((id, i) => {
                        const el = document.getElementById(id);
                        if (el) el.value = best[i];
                    });
                    aiResultBox.style.display = 'block';
                    pendingAiDigits = best;
                    showToast('✅ Ponteiros decifrados! Confirme ou corrija os dígitos.');
                } else {
                    throw new Error('Não consegui identificar os 4 ponteiros na foto.');
                }
                
            } catch (err) {
                console.error('Erro na leitura da foto:', err);
                aiStatus.textContent = `❌ ${err.message}`;
                showToast(`❌ Falha: ${err.message}`, true);
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
                fileInput.value = '';
            }
        });
    };

    handleFile('cameraLeitura', 'btnCameraLeitura');
    handleFile('cameraUpload', 'btnUploadLeitura');

    // Função dos spinners ▲▼ nos dígitos editáveis
    window.adjustDigit = (id, delta) => {
        const el = document.getElementById(id);
        if (!el) return;
        let val = (parseInt(el.value) || 0) + delta;
        if (val < 0) val = 9;
        if (val > 9) val = 0;
        el.value = val;
        // Atualiza pendingAiDigits
        pendingAiDigits = ['d0','d1','d2','d3'].map(i => document.getElementById(i)?.value || '0').join('');
    };

    // Quando os inputs são editados diretamente
    ['cam0','cam1','cam2','cam3'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => {
            pendingAiDigits = ['cam0','cam1','cam2','cam3'].map(i => document.getElementById(i)?.value || '0').join('');
        });
    });

    // Botão de Salvar API Key
    const btnSaveApiKey = document.getElementById('btnSaveApiKey');
    if (btnSaveApiKey) {
        btnSaveApiKey.addEventListener('click', () => {
            const val = document.getElementById('geminiKeyInput').value.trim();
            if (val) {
                localStorage.setItem('GEMINI_KEY', val);
                document.getElementById('apiKeyCard').style.display = 'none';
                showToast('✅ Chave salva com sucesso!');
            } else {
                showToast('⚠️ Chave inválida', true);
            }
        });
    }

    // Botão de Aplicar
    const btnApplyAi = document.getElementById('btnApplyAi');
    if (btnApplyAi) {
        btnApplyAi.addEventListener('click', () => {
            // Ler valores atuais dos inputs (usuário pode ter corrigido com os spinners)
            const currentDigits = ['cam0','cam1','cam2','cam3']
                .map(id => { const el = document.getElementById(id); return el ? String(parseInt(el.value)||0) : '0'; })
                .join('');

            if (currentDigits.length !== 4) return;

            // Salvar correção no localStorage para few-shot dinâmico
            if (pendingAiDigits && pendingAiDigits !== currentDigits) {
                const names = ['Thousands','Hundreds','Tens','Units'];
                const wrongDigits = names.filter((_, i) => pendingAiDigits[i] !== currentDigits[i]);
                db.set('ai_last_correction', { predicted: pendingAiDigits, correct: currentDigits, wrongDigits, ts: new Date().toISOString() });
                console.log(`📝 Correção: IA=${pendingAiDigits} → Correto=${currentDigits} (${wrongDigits.join(', ')})`);
            }

            // Transportar para a aba de Leitura — marcar como origem 'relogio'
            db.set('ai_pending_source', 'relogio');
            ['d0','d1','d2','d3'].forEach((id, i) => { document.getElementById(id).value = currentDigits[i]; });
            updatePreview();

            // Trocar aba
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            document.querySelector('[data-tab="leitura"]').classList.add('active');
            document.getElementById('secLeitura').classList.add('active');

            // Reset state
            document.getElementById('aiResultBox').style.display = 'none';
            document.getElementById('photoPreviewImg').style.display = 'none';
            document.getElementById('photoPreviewImg').src = '';
            document.getElementById('aiStatus').textContent = 'Aguardando foto...';
            pendingAiDigits = '';

            showToast('✅ Leitura importada. Revise e salve!');
        });
    }
}

// ─────────────────────────────────────────────────────────────
//  IMPORT FILE (PDF or Image) WITH GEMINI
// ─────────────────────────────────────────────────────────────
function initImportFile() {
    const handleFile = async (fileInputId, btnId) => {
        const fileInput = document.getElementById(fileInputId);
        if (!fileInput) return;

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            let GEMINI_KEY = (typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.GEMINI_KEY : null) || localStorage.getItem('GEMINI_KEY');
            if (!GEMINI_KEY) {
                document.getElementById('apiKeyCard').style.display = 'block';
                showToast('⚠️ Cole sua chave do Gemini na aba Relógio primeiro.', true);
                fileInput.value = '';
                return;
            }

            showToast('🤖 Analisando documento com IA...');
            const btn = document.getElementById(btnId);
            const originalText = btn.textContent;
            btn.textContent = '⏳ Lendo...';
            btn.disabled = true;

            try {
            const base64Data = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(file);
            });

            const prompt = `You are a data extraction expert for Brazilian electricity bills (Light S.A.).
Extract the following fields from this bill and return ONLY a valid JSON object:

{
  "date_atual": "YYYY-MM-DD",  // Data desta leitura (campo 'Leitura Atual' ou 'Data de Leitura')
  "date_next": "YYYY-MM-DD",   // Data da próxima leitura
  "raw_atual": "NNNN",          // Leitura atual do medidor em kWh (apenas dígitos, sem decimais)
  "raw_anterior": "NNNN",       // Leitura anterior do medidor
  "consumo": "NNN",             // Consumo total do período em kWh (número inteiro)
  "valor_total": "NNN.NN"       // Valor total da conta em R$
}

Rules:
- For dates, look for 'Leitura Atual', 'Próxima Leitura', or similar labels
- For the meter reading (raw_atual), look for kWh consumption table; if format is like '3825.0', use only integer part '3825'
- Return ONLY the JSON, no markdown, no explanation`;

            const useProxy = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
            let res;
            if (useProxy) {
                res = await fetch('/api/gemini', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: 'gemini-2.5-flash', body: {
                        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: file.type, data: base64Data } }] }],
                        generationConfig: { responseMimeType: 'application/json' }
                    }})
                });
            } else {
                res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: file.type, data: base64Data } }] }],
                        generationConfig: { responseMimeType: 'application/json' }
                    })
                });
            }

            if (!res.ok) throw new Error('Erro na API Gemini');
            const data = await res.json();
            const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!aiText) throw new Error('Resposta vazia da IA');

            const json = JSON.parse(aiText);
            
            if (!json.date_atual || !json.raw_atual) throw new Error('Dados incompletos extraídos');

            const rawAtual = parseInt(json.raw_atual);
            if (isNaN(rawAtual)) throw new Error('Não foi possível ler o medidor');

            const newReading = {
                id: Date.now(),
                timestamp: json.date_atual,
                raw: rawAtual,
                kwh: rawAtual * MULT,
                dateNext: json.date_next || '',
                expected: json.consumo ? parseInt(json.consumo) : 0,
                source: 'conta'  // Importado da conta Light
            };

            const readings = db.get(SK_READINGS) || [];
            if (readings.some(r => r.timestamp === newReading.timestamp)) {
                showToast('⚠️ Leitura para esta data já existe no histórico!', true);
                return;
            }

            readings.push(newReading);
            readings.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            db.set(SK_READINGS, readings);

            showToast('✅ Conta importada com sucesso!');
            refresh();
            
        } catch (err) {
            console.error('Erro na importação:', err);
            showToast(`❌ Falha ao importar: ${err.message}`, true);
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
            fileInput.value = '';
        }
    });
    };

    handleFile('fileImport', 'btnImportFile');
    handleFile('cameraImport', 'btnCameraImport');
}

// ─────────────────────────────────────────────────────────────
//  DATE DEFAULTS
// ─────────────────────────────────────────────────────────────
function initDateDefaults() {
    const readings = db.get(SK_READINGS) || [];
    let defaultReadingDate = new Date();
    let defaultNextDate = new Date();
    defaultNextDate.setDate(defaultNextDate.getDate() + 30);
    let defaultExpected = '';

    if (readings.length > 0) {
        const last = readings[readings.length - 1];
        if (last.expected) {
            defaultExpected = last.expected;
        }
    }

    const ri = document.getElementById('dateReading');
    const ni = document.getElementById('dateNext');
    const exp = document.getElementById('expectedKwh');
    
    // Só substitui se estiver vazio
    if (!ri.value) ri.value = toInput(defaultReadingDate);
    if (!ni.value) ni.value = toInput(defaultNextDate);
    if (!exp.value) exp.value = defaultExpected;
}

// ─────────────────────────────────────────────────────────────
//  DIALS
// ─────────────────────────────────────────────────────────────
function initDials() {
    ['d0', 'd1', 'd2', 'd3'].forEach((id, idx, arr) => {
        const el = document.getElementById(id);
        el.addEventListener('input', () => {
            if (el.value.length > 1) el.value = el.value.slice(-1);
            const v = parseInt(el.value);
            if (!isNaN(v)) {
                el.value = Math.min(Math.max(v, 0), 9);
                if (idx < arr.length - 1 && el.value !== '')
                    document.getElementById(arr[idx + 1]).focus();
            }
            updatePreview();
        });
        el.addEventListener('keydown', e => {
            if (e.key === 'Backspace' && el.value === '' && idx > 0)
                document.getElementById(arr[idx - 1]).focus();
        });
        el.addEventListener('focus', () => el.select());
    });
    updatePreview();
}

function getDialRaw() {
    const vals = ['d0', 'd1', 'd2', 'd3'].map(id => {
        const v = document.getElementById(id).value;
        return v === '' ? null : parseInt(v);
    });
    if (vals.some(v => v === null)) return null;
    return vals[0] * 1000 + vals[1] * 100 + vals[2] * 10 + vals[3];
}

function updatePreview() {
    const vals = ['d0', 'd1', 'd2', 'd3'].map(id => {
        const v = document.getElementById(id).value;
        return v === '' ? null : parseInt(v);
    });
    const rawEl = document.getElementById('previewRaw');
    const kwhEl = document.getElementById('previewKwh');
    const totalEl = document.getElementById('previewTotal');

    if (vals.some(v => v === null)) {
        kwhEl.textContent = '– kWh';
        if (totalEl) totalEl.innerHTML = '';
        return;
    }

    const raw = vals[0] * 1000 + vals[1] * 100 + vals[2] * 10 + vals[3];
    rawEl.textContent = String(raw).padStart(4, '0');

    const readings = db.get(SK_READINGS) || [];
    if (readings.length > 0) {
        const last = readings[readings.length - 1];
        const lastRaw = last.raw;
        const diff = raw - lastRaw;

        // Calculate expected future reading & daily rate
        let prevDailyRate = 0;
        if (readings.length >= 2) {
            const prev = readings[readings.length - 2];
            const prevDays = Math.max(1, Math.round((new Date(last.timestamp + 'T12:00:00') - new Date(prev.timestamp + 'T12:00:00')) / 86400000));
            prevDailyRate = ((last.raw - prev.raw) * MULT) / prevDays;
        } else {
            prevDailyRate = last.expected ? (last.expected / 30) : 0;
        }
        
        // A meta do mês atual vai desde a leitura anterior até a data que estava prevista (last.dateNext)
        const periodStart = new Date(last.timestamp + 'T12:00:00');
        const periodEnd = new Date(last.dateNext + 'T12:00:00');
        const periodTotal = Math.max(1, Math.round((periodEnd - periodStart) / 86400000));
        
        // Pega a data real de HOJE para calcular a "Meta Hoje", ignorando a caixinha
        const todayReal = new Date();
        const daysPassed = Math.max(0, Math.round((todayReal - periodStart) / 86400000));
        
        const expectedTotalKwh = prevDailyRate * periodTotal;
        const expByToday = prevDailyRate * daysPassed;
        
        const expectedRawDiff = Math.round(expectedTotalKwh / MULT);
        const expectedFutureRaw = lastRaw + expectedRawDiff;
        
        const expectedRawTodayDiff = Math.round(expByToday / MULT);
        const expectedTodayRaw = lastRaw + expectedRawTodayDiff;

        const kwhWrap = document.getElementById('previewKwhWrap') || kwhEl;

        if (diff >= 0) {
            const consumoKwh = diff * MULT;
            
            // Lógica de alerta visual
            let color = 'var(--accent-green)';
            let icon = '🟢';
            if (consumoKwh > expByToday * 1.1) {
                color = 'var(--accent-red)';
                icon = '🔴 Alto:';
            } else if (consumoKwh > expByToday * 1.0) {
                color = 'var(--accent-amber)';
                icon = '⚠️ Atenção:';
            } else {
                icon = '🟢 OK:';
            }
            
            kwhWrap.innerHTML = `<span style="font-weight:normal; color:var(--text-muted)">Meta Hoje: ${String(expectedTodayRaw).padStart(4, '0')} &nbsp;|&nbsp; </span><strong style="color:${color}">${icon} ${consumoKwh.toLocaleString('pt-BR')} kWh</strong>`;
            if (totalEl) totalEl.innerHTML =
                `<div style="font-size:1.1rem; color:var(--text-primary); margin-top:8px; display:flex; justify-content:space-around; background:rgba(0,0,0,0.3); padding:8px; border-radius:8px;">
                    <div>Anterior: <strong style="color:var(--text-muted)">${String(lastRaw).padStart(4, '0')}</strong></div>
                    <div>Meta (Final): <strong style="color:var(--accent-blue)">${String(expectedFutureRaw).padStart(4, '0')}</strong></div>
                </div>`;
        } else {
            // Warning: current < previous
            kwhEl.innerHTML = '<span style="color:var(--accent-red)">⚠️ Menor que leitura anterior</span>';
            if (totalEl) totalEl.innerHTML =
                `<div style="font-size:1.1rem; color:var(--text-primary); margin-top:8px; display:flex; justify-content:space-around; background:rgba(0,0,0,0.3); padding:8px; border-radius:8px;">
                    <div>Anterior: <strong style="color:var(--text-muted)">${String(lastRaw).padStart(4, '0')}</strong></div>
                    <div>Meta (Final): <strong style="color:var(--accent-blue)">${String(expectedFutureRaw).padStart(4, '0')}</strong></div>
                </div>`;
        }
    } else {
        // No previous reading — show total with note
        kwhEl.textContent = '– kWh';
        if (totalEl) totalEl.textContent =
            `(sem leitura anterior para calcular consumo) • Acumulado: ${(raw * MULT).toLocaleString('pt-BR')} kWh`;
    }

    // Also update the live monitor
    renderMonitor(raw);
}

// ─────────────────────────────────────────────────────────────
//  REGISTER READING
// ─────────────────────────────────────────────────────────────
function initRegisterBtn() {
    document.getElementById('btnRegistrar').addEventListener('click', registerReading);
}

function registerReading() {
    const raw = getDialRaw();
    if (raw === null) { showToast('⚠️ Preencha todos os 4 ponteiros!', true); return; }

    const readings = db.get(SK_READINGS) || [];
    if (readings.length > 0 && raw < readings[readings.length - 1].raw) {
        showToast(`⚠️ Leitura (${raw}) menor que a anterior (${readings[readings.length - 1].raw})`, true);
        return;
    }

    const dateVal = document.getElementById('dateReading').value || toInput(new Date());
    const dateNext = document.getElementById('dateNext').value || null;
    const expVal = parseFloat(document.getElementById('expectedKwh').value);
    const expected = (!isNaN(expVal) && expVal > 0) ? expVal : null;

    // source: 'relogio' se veio da câmera IA, 'manual' se digitado
    const source = db.get('ai_pending_source') || 'manual';
    db.set('ai_pending_source', null);
    readings.push({ id: Date.now(), timestamp: dateVal, raw, kwh: raw * MULT, dateNext, expected, source });
    db.set(SK_READINGS, readings);

    showToast('✅ Leitura registrada!');
    clearForm();
    refresh();
}

function clearForm() {
    ['d0', 'd1', 'd2', 'd3'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('expectedKwh').value = '';
    updatePreview();
    initDateDefaults();
}

// ─────────────────────────────────────────────────────────────
//  MODAL — edit or insert
// ─────────────────────────────────────────────────────────────
function initModal() {
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalCancel').addEventListener('click', closeModal);
    document.getElementById('modalOverlay').addEventListener('click', e => {
        if (e.target === document.getElementById('modalOverlay')) closeModal();
    });
    document.getElementById('modalSave').addEventListener('click', saveModal);

    // "Inserir leitura anterior" button
    document.getElementById('btnInsertPrev').addEventListener('click', () => {
        openModal(null); // null = insert new
    });
}

function openModal(readingId) {
    const readings = db.get(SK_READINGS) || [];
    const isNew = readingId === null;
    const r = isNew ? null : readings.find(x => x.id === readingId);

    document.getElementById('modalTitle').textContent = isNew ? '➕ Inserir Leitura Anterior' : '✏️ Editar Leitura';
    document.getElementById('modalReadingId').value = isNew ? '' : readingId;
    document.getElementById('modalRaw').value = r ? r.raw : '';
    document.getElementById('modalExpected').value = r?.expected ?? '';
    document.getElementById('modalDateNext').value = r?.dateNext ?? '';

    // Date defaults
    if (r) {
        document.getElementById('modalDate').value = r.timestamp;
    } else {
        // Default for previous reading: 30 days ago
        const prev = new Date(); prev.setDate(prev.getDate() - 30);
        document.getElementById('modalDate').value = toInput(prev);
    }

    document.getElementById('modalOverlay').style.display = '';
    document.getElementById('modalRaw').focus();
}

function closeModal() {
    document.getElementById('modalOverlay').style.display = 'none';
}

function saveModal() {
    const idVal = document.getElementById('modalReadingId').value;
    const rawVal = parseInt(document.getElementById('modalRaw').value);
    const date = document.getElementById('modalDate').value;
    const dnext = document.getElementById('modalDateNext').value || null;
    const expVal = parseFloat(document.getElementById('modalExpected').value);
    const expected = (!isNaN(expVal) && expVal > 0) ? expVal : null;

    if (!date) { showToast('⚠️ Informe a data da leitura', true); return; }
    if (isNaN(rawVal) || rawVal < 0 || rawVal > 9999) {
        showToast('⚠️ Valor do marcador inválido (0–9999)', true); return;
    }

    let readings = db.get(SK_READINGS) || [];

    if (!idVal) {
        // INSERT NEW
        const newEntry = {
            id: Date.now(),
            timestamp: date,
            raw: rawVal,
            kwh: rawVal * MULT,
            dateNext: dnext,
            expected
        };
        readings.push(newEntry);
    } else {
        // EDIT EXISTING
        const rid = parseInt(idVal);
        readings = readings.map(r => r.id === rid
            ? { ...r, timestamp: date, raw: rawVal, kwh: rawVal * MULT, dateNext: dnext, expected }
            : r
        );
    }

    // Sort by date after insert/edit
    readings.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    db.set(SK_READINGS, readings);

    closeModal();
    showToast(idVal ? '✅ Leitura atualizada!' : '✅ Leitura anterior inserida!');
    refresh();
}

// ─────────────────────────────────────────────────────────────
//  REFRESH: update all dynamic UI
// ─────────────────────────────────────────────────────────────
function refresh() {
    renderPrevAlert();
    renderMonitor(null);   // static view (no live reading)
    renderLastConsumption();
    renderHistory();
    updateStats();
    if (chartInstance) renderChart();
}

// ─────────────────────────────────────────────────────────────
//  PREV ALERT BANNER
// ─────────────────────────────────────────────────────────────
function renderPrevAlert() {
    const readings = db.get(SK_READINGS) || [];
    const alert = document.getElementById('prevAlert');
    alert.style.display = readings.length < 2 ? '' : 'none';
}

// ─────────────────────────────────────────────────────────────
//  MONITOR DO PERÍODO ATUAL
// ─────────────────────────────────────────────────────────────
/**
 * Renders the period monitor card.
 * liveRaw: current dial reading (number) or null (no live input yet)
 * 
 * Logic:
 *   periodStart = last reading's date
 *   periodEnd   = last reading's dateNext
 *   periodTotal = days(periodEnd - periodStart) e.g. 30
 *   daysPassed  = days(today - periodStart)     e.g. 20
 *   dailyRate   = expectedKwh / periodTotal     e.g. 10 kWh/day
 *   expectedByToday = dailyRate × daysPassed    e.g. 200 kWh
 *   actualNow   = (liveRaw - lastRaw) × 10      e.g. 220 kWh
 *   deviationPct = (actual - expected) / expected × 100
 */
function renderMonitor(liveRaw) {
    const card = document.getElementById('monitorCard');
    const readings = db.get(SK_READINGS) || [];

    // Need at least 1 reading with dateNext and expected to show monitor
    if (readings.length < 1) { card.style.display = 'none'; return; }

    const last = readings[readings.length - 1];
    if (!last.dateNext || !last.expected) { card.style.display = 'none'; return; }

    card.style.display = '';

    // ── Date math ──
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const parse = s => { const d = new Date(s + 'T12:00:00'); return d; };
    const d = (a, b) => Math.round((b - a) / 86400000);

    const periodStart = parse(last.timestamp);
    const periodEnd = parse(last.dateNext);
    const periodTotal = Math.max(1, d(periodStart, periodEnd)); // ex: 30 days
    const daysPassed = Math.max(0, d(periodStart, today));     // ex: 20
    const daysRemaining = Math.max(0, periodTotal - daysPassed);
    const pct = Math.min(100, Math.round((daysPassed / periodTotal) * 100));

    // ── Consumption math ──
    let prevDailyRate = 0;
    let prevKwh = 0;
    let prevDays = 30;
    if (readings.length >= 2) {
        const prev = readings[readings.length - 2];
        prevDays = Math.max(1, d(parse(prev.timestamp), periodStart));
        prevKwh = (last.raw - prev.raw) * MULT;
        prevDailyRate = prevKwh / prevDays;
    } else {
        prevDailyRate = last.expected ? (last.expected / periodTotal) : 0;
    }

    const expTotal = Math.round(prevDailyRate * periodTotal);  // Adjusted expected total for this period
    const dailyRate = prevDailyRate;                           // Expected daily rate = previous daily rate
    const expByToday = Math.round(dailyRate * daysPassed);     // Expected consumed until today

    const hasLive = liveRaw !== null && !isNaN(liveRaw) && liveRaw >= last.raw;
    const actualKwh = hasLive ? (liveRaw - last.raw) * MULT : null; // ex: 220 kWh

    // ── Header info ──
    document.getElementById('monitorHeader').innerHTML =
        `Última marcação: <strong>${String(last.raw).padStart(4, '0')}</strong> em ${fmtDate(last.timestamp)}
         &nbsp;|
         Próxima: ${fmtDate(last.dateNext)}
         • Esperado no período: <strong>${expTotal.toLocaleString('pt-BR')} kWh</strong>`;

    // ── Days progress bar ──
    document.getElementById('monitorDaysFill').style.width = pct + '%';
    document.getElementById('monitorDaysLabel').textContent =
        daysPassed <= periodTotal
            ? `Dia ${daysPassed} de ${periodTotal} (${daysRemaining} restantes)`
            : `${daysPassed - periodTotal} dia(s) após o prazo`;
    document.getElementById('monitorDaysTotal').textContent =
        `${dailyRate.toFixed(1)} kWh/dia`;

    // ── Compare block ──
    document.getElementById('monitorExpected').textContent =
        expByToday.toLocaleString('pt-BR');

    const hint = document.getElementById('monitorHint');

    if (hasLive) {
        hint.style.display = 'none';
        document.getElementById('monitorActual').textContent =
            actualKwh.toLocaleString('pt-BR');

        const delta = actualKwh - expByToday;               // positive = above
        const devPct = expByToday > 0
            ? Math.round((delta / expByToday) * 100)
            : 0;

        // Status classification
        const absPct = Math.abs(devPct);
        let cls, icon, label;
        if (absPct <= 5) {
            cls = 'ok'; icon = '🎯'; label = 'Dentro do esperado';
        } else if (delta < 0) {
            cls = 'ok'; icon = '▼'; label = `${absPct}% abaixo — Ótimo!`;
        } else if (devPct <= 15) {
            cls = 'warn'; icon = '⚠️'; label = `${devPct}% acima — atenção`;
        } else {
            cls = 'over'; icon = '🔴'; label = `${devPct}% acima — reduza o consumo`;
        }

        const badge = document.getElementById('monitorBadge');
        badge.className = `monitor-status-badge ${cls}`;
        badge.textContent = `${icon} ${label}`;

        // ── Projection: dailyAvg × full period length ──
        // daysPassed > 0 guaranteed because hasLive requires liveRaw >= last.raw
        const dailyAvg = daysPassed > 0 ? actualKwh / daysPassed : 0;
        const projected = Math.round(dailyAvg * periodTotal);   // always consistent
        const projDelta = projected - expTotal;
        const projSign = projDelta > 0 ? '+' : '';

        document.getElementById('monitorProjection').innerHTML =
            `<div class="proj-label">Consumo previsto em ${fmtDate(last.dateNext)}</div>
             <div class="proj-value ${cls}">${projected.toLocaleString('pt-BR')} kWh</div>
             <div class="proj-sub">
               M\u00e9dia atual: ${dailyAvg.toFixed(1)} kWh/dia &nbsp;\u2022&nbsp;
               ${projSign}${projDelta.toLocaleString('pt-BR')} kWh vs esperado (${expTotal.toLocaleString('pt-BR')} kWh)
             </div>`;

        // Color the actual value
        const actualEl = document.getElementById('monitorActual');
        actualEl.style.color = cls === 'ok' ? 'var(--accent-green)'
            : cls === 'warn' ? 'var(--accent-amber)' : 'var(--accent-red)';

    } else {
        // No live reading yet
        hint.style.display = '';
        document.getElementById('monitorActual').textContent = '?';
        document.getElementById('monitorActual').style.color = 'var(--text-muted)';
        document.getElementById('monitorBadge').className = 'monitor-status-badge';
        document.getElementById('monitorBadge').textContent = '';
        document.getElementById('monitorProjection').textContent = '';
    }
}

// ─────────────────────────────────────────────────────────────
//  LAST CONSUMPTION (section 1 quick card)
// ─────────────────────────────────────────────────────────────
function renderLastConsumption() {
    const readings = db.get(SK_READINGS) || [];
    const card = document.getElementById('lastConsumptionCard');
    if (readings.length < 2) { card.style.display = 'none'; return; }

    const last = readings[readings.length - 1];
    const prev = readings[readings.length - 2];
    const diff = (last.raw - prev.raw) * MULT;
    const days = daysBetween(prev.timestamp, last.timestamp) || 1;

    document.getElementById('lastConsumptionKwh').textContent = diff.toLocaleString('pt-BR');
    document.getElementById('lastDays').textContent = days;
    card.style.display = '';
}

// ─────────────────────────────────────────────────────────────
//  HISTORY FILTER
// ─────────────────────────────────────────────────────────────
function setHistoryFilter(f) {
    currentHistoryFilter = f;
    // Atualizar visual dos botões
    ['filterAll','filterConta','filterRelogio'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const active = (id === 'filter' + f.charAt(0).toUpperCase() + f.slice(1)) ||
                       (f === 'all' && id === 'filterAll');
        btn.style.background = active ? 'rgba(0,212,255,0.15)' : 'transparent';
        btn.style.borderColor = active ? 'rgba(0,212,255,0.4)' : 'rgba(255,255,255,0.1)';
        btn.style.color = active ? 'var(--accent-blue)' : 'var(--text-muted)';
    });
    renderHistory();
}

// ─────────────────────────────────────────────────────────────
//  HISTORY
// ─────────────────────────────────────────────────────────────
function renderHistory() {
    const allReadings = db.get(SK_READINGS) || [];
    const list = document.getElementById('historyList');

    // Aplicar filtro
    const readings = currentHistoryFilter === 'all' ? allReadings :
                     currentHistoryFilter === 'conta' ? allReadings.filter(r => r.source === 'conta') :
                     allReadings.filter(r => r.source !== 'conta'); // relogio + manual + undefined

    if (allReadings.length === 0) {
        list.innerHTML = `<div class="empty-state"><span class="empty-icon">💭</span>
      <p>Nenhuma leitura ainda. Use "Leitura" para registrar<br>ou "Inserir leitura anterior" para começar.</p></div>`;
        return;
    }

    if (readings.length === 0) {
        const label = currentHistoryFilter === 'conta' ? '📄 Contas Light' : '🕐 Marcações do Relógio';
        list.innerHTML = `<div class="empty-state"><span class="empty-icon">🔍</span><p>Nenhum registro do tipo "${label}" ainda.</p></div>`;
        return;
    }

    list.innerHTML = [...readings].reverse().map((r, idx) => {
        const origIdx = allReadings.findIndex(x => x.id === r.id);
        const prev = allReadings[origIdx - 1];

        // ── Consumption block ──
        let consumHtml = '';
        if (prev) {
            const diff = (r.raw - prev.raw) * MULT;
            const days = daysBetween(prev.timestamp, r.timestamp) || 1;
            let badge = '';

            if (r.expected !== null && r.expected !== undefined) {
                const delta = diff - r.expected;
                const pct = Math.abs(Math.round((delta / r.expected) * 100));
                if (Math.abs(delta) <= r.expected * 0.05) {
                    badge = `<span class="consumption-compare on-target">🎯 No alvo</span>`;
                } else if (delta > 0) {
                    badge = `<span class="consumption-compare over">▲ +${delta.toLocaleString('pt-BR')} kWh (${pct}% acima)</span>`;
                } else {
                    badge = `<span class="consumption-compare under">▼ ${Math.abs(delta).toLocaleString('pt-BR')} kWh (${pct}% abaixo)</span>`;
                }
            }

            const expectedLine = r.expected
                ? `<div style="font-size:.65rem;color:var(--text-muted)">Esperado: ${r.expected} kWh</div>` : '';

            consumHtml = `
        <div class="history-consumption">
          <strong>${diff.toLocaleString('pt-BR')} kWh</strong>
          ${days} dia${days !== 1 ? 's' : ''}
          ${expectedLine}${badge}
        </div>`;
        } else {
            consumHtml = `<div class="history-consumption" style="color:var(--text-muted);font-size:.7rem">Leitura base</div>`;
        }

        const nextBadge = r.dateNext
            ? `<div class="history-next-date">🗓️ Próxima: ${fmtDate(r.dateNext)}</div>` : '';

        const sourceBadge = r.source === 'conta'
            ? `<span style="font-size:.6rem;padding:2px 6px;border-radius:10px;background:rgba(0,212,255,0.1);color:var(--accent-blue);border:1px solid rgba(0,212,255,0.3);">📄 Conta Light</span>`
            : r.source === 'relogio'
            ? `<span style="font-size:.6rem;padding:2px 6px;border-radius:10px;background:rgba(0,230,118,0.1);color:var(--accent-green);border:1px solid rgba(0,230,118,0.3);">🕐 Relógio</span>`
            : `<span style="font-size:.6rem;padding:2px 6px;border-radius:10px;background:rgba(255,255,255,0.05);color:var(--text-muted);border:1px solid rgba(255,255,255,0.1);">✏️ Manual</span>`;

        return `
      <div class="history-item">
        <div class="history-date">${fmtDate(r.timestamp)} ${sourceBadge}</div>
        <div class="history-reading">${String(r.raw).padStart(4, '0')}</div>
        <div class="history-kwh">× 10 = ${r.kwh.toLocaleString('pt-BR')} kWh${nextBadge}</div>
        ${consumHtml}
        <div style="grid-column:2;grid-row:1/4;display:flex;flex-direction:column;gap:4px;align-items:flex-end">
          <button class="btn-edit" onclick="openModal(${r.id})" aria-label="Editar">✏️</button>
          <button class="btn btn-danger" onclick="deleteReading(${r.id})" aria-label="Remover">🗑</button>
        </div>
      </div>`;
    }).join('');
}

function deleteReading(id) {
    let readings = db.get(SK_READINGS) || [];
    readings = readings.filter(r => r.id !== id);
    db.set(SK_READINGS, readings);
    showToast('🗑 Leitura removida');
    refresh();
}

// ─────────────────────────────────────────────────────────────
//  CHART
// ─────────────────────────────────────────────────────────────
function renderChart() {
    const readings = db.get(SK_READINGS) || [];
    if (readings.length < 2) {
        if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
        return;
    }

    const labels = [], dataReal = [], dataExp = [];
    let hasExp = false;

    for (let i = 1; i < readings.length; i++) {
        const diff = (readings[i].raw - readings[i - 1].raw) * MULT;
        labels.push(fmtDate(readings[i].timestamp));
        dataReal.push(diff);
        dataExp.push(readings[i].expected ?? null);
        if (readings[i].expected) hasExp = true;
    }

    const ctx = document.getElementById('chartConsumption').getContext('2d');
    if (chartInstance) chartInstance.destroy();

    const maxR = Math.max(...dataReal);
    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Consumo real (kWh)',
                    data: dataReal,
                    backgroundColor: dataReal.map(v => {
                        const r = v / maxR;
                        return r > 0.75 ? 'rgba(255,71,87,0.75)' : r > 0.5 ? 'rgba(245,166,35,0.75)' : 'rgba(0,212,255,0.75)';
                    }),
                    borderColor: dataReal.map(v => {
                        const r = v / maxR;
                        return r > 0.75 ? '#ff4757' : r > 0.5 ? '#f5a623' : '#00d4ff';
                    }),
                    borderWidth: 1.5, borderRadius: 6
                },
                ...(hasExp ? [{
                    type: 'line',
                    label: 'Esperado (kWh)',
                    data: dataExp,
                    borderColor: 'rgba(245,166,35,0.7)',
                    backgroundColor: 'rgba(245,166,35,0.06)',
                    borderDash: [5, 4], borderWidth: 2,
                    pointBackgroundColor: '#f5a623', pointRadius: 4,
                    tension: 0.3, fill: false, spanGaps: true
                }] : [])
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: hasExp, labels: { color: '#7a8ba0', font: { family: 'Outfit', size: 11 } } },
                tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${(c.parsed.y || 0).toLocaleString('pt-BR')} kWh` } }
            },
            scales: {
                x: { ticks: { color: '#7a8ba0', font: { family: 'Outfit', size: 10 }, maxRotation: 45 }, grid: { color: 'rgba(255,255,255,0.05)' } },
                y: { ticks: { color: '#7a8ba0', font: { family: 'Outfit', size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true }
            }
        }
    });
}

// ─────────────────────────────────────────────────────────────
//  STATS
// ─────────────────────────────────────────────────────────────
function updateStats() {
    const readings = db.get(SK_READINGS) || [];
    document.getElementById('statTotal').textContent = readings.length;
    if (readings.length < 2) {
        ['statAvg', 'statMax', 'statMin'].forEach(id => document.getElementById(id).textContent = '–');
        return;
    }
    const diffs = [];
    for (let i = 1; i < readings.length; i++) diffs.push((readings[i].raw - readings[i - 1].raw) * MULT);
    document.getElementById('statAvg').textContent = Math.round(diffs.reduce((a, b) => a + b) / diffs.length).toLocaleString('pt-BR');
    document.getElementById('statMax').textContent = Math.max(...diffs).toLocaleString('pt-BR');
    document.getElementById('statMin').textContent = Math.min(...diffs).toLocaleString('pt-BR');
}

// ─────────────────────────────────────────────────────────────
//  APPLIANCE CALCULATOR
// ─────────────────────────────────────────────────────────────
function initApplianceCalc() {
    const saved = db.get(SK_TARIFF);
    if (saved) document.getElementById('tariffInput').value = saved;

    document.getElementById('tariffInput').addEventListener('input', () => {
        const val = parseFloat(document.getElementById('tariffInput').value);
        if (!isNaN(val) && val > 0) { db.set(SK_TARIFF, val); renderAppliances(); }
    });
    document.getElementById('btnAddAppliance').addEventListener('click', addAppliance);
    document.getElementById('appHours').addEventListener('keypress', e => { if (e.key === 'Enter') addAppliance(); });
    renderAppliances();
}

function addAppliance() {
    const name = document.getElementById('appName').value.trim();
    const power = parseFloat(document.getElementById('appPower').value);
    const hours = parseFloat(document.getElementById('appHours').value);
    if (!name) { showToast('⚠️ Informe o nome', true); return; }
    if (isNaN(power) || power <= 0) { showToast('⚠️ Potência inválida', true); return; }
    if (isNaN(hours) || hours <= 0) { showToast('⚠️ Horas inválido', true); return; }
    const list = db.get(SK_APPLIANCES) || [];
    list.push({ id: Date.now(), name, power, hours });
    db.set(SK_APPLIANCES, list);
    document.getElementById('appName').value = document.getElementById('appPower').value = document.getElementById('appHours').value = '';
    document.getElementById('appName').focus();
    renderAppliances();
    showToast(`✅ "${name}" adicionado!`);
}

function deleteAppliance(id) {
    db.set(SK_APPLIANCES, (db.get(SK_APPLIANCES) || []).filter(a => a.id !== id));
    renderAppliances();
}

function renderAppliances() {
    const list = db.get(SK_APPLIANCES) || [];
    const tariff = parseFloat(document.getElementById('tariffInput').value) || 0.95;
    const ul = document.getElementById('applianceList');
    const totalEl = document.getElementById('applianceTotal');

    if (!list.length) {
        ul.innerHTML = `<div class="empty-state"><span class="empty-icon">🔌</span><p>Nenhum aparelho cadastrado.</p></div>`;
        totalEl.style.display = 'none'; return;
    }
    let grand = 0;
    ul.innerHTML = list.map(a => {
        const kwh = (a.power * a.hours * 30) / 1000;
        const cost = kwh * tariff;
        grand += kwh;
        return `<div class="appliance-item">
      <div>
        <div class="appliance-name">${esc(a.name)}</div>
        <div class="appliance-detail">${a.power}W · ${a.hours}h/dia</div>
      </div>
      <div class="appliance-kwh">
        <div class="kwh-val">${kwh.toFixed(1)} kWh</div>
        <div class="kwh-cost">R$ ${cost.toFixed(2)}</div>
        <div class="kwh-label">/mês</div>
      </div>
      <button class="btn btn-danger" onclick="deleteAppliance(${a.id})">🗑</button>
    </div>`;
    }).join('');
    document.getElementById('totalKwh').textContent = grand.toFixed(1) + ' kWh/mês';
    document.getElementById('totalCost').textContent = 'R$ ' + (grand * tariff).toFixed(2) + '/mês';
    totalEl.style.display = '';
}

// ─────────────────────────────────────────────────────────────
//  PWA
// ─────────────────────────────────────────────────────────────
function initPWA() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => { });

    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault(); deferredInstall = e;
        const banner = document.getElementById('installBanner');
        banner.classList.remove('hidden');
        banner.addEventListener('click', async () => {
            banner.classList.add('hidden');
            deferredInstall.prompt();
            const r = await deferredInstall.userChoice;
            if (r.outcome === 'accepted') showToast('📲 App instalado!');
            deferredInstall = null;
        });
    });
    window.addEventListener('appinstalled', () => {
        document.getElementById('installBanner').classList.add('hidden');
        showToast('📲 App instalado!');
    });
}

// ─────────────────────────────────────────────────────────────
//  SEED: dados históricos (executado apenas na primeira abertura)
// ─────────────────────────────────────────────────────────────
function seedHistoricalData() {
    // Só executa se não houver nenhum dado salvo ainda
    if (db.get(SK_READINGS) && db.get(SK_READINGS).length > 0) return;

    const MULT10 = 10;
    // consumo = diferença bruta do marcador; consumo × 10 = kWh reais
    const SEED = [
        { timestamp: '2025-04-03', raw: 3333, dateNext: '2025-05-05', consumo: 41 },
        { timestamp: '2025-05-05', raw: 3375, dateNext: '2025-06-04', consumo: 42 },
        { timestamp: '2025-06-04', raw: 3418, dateNext: '2025-07-07', consumo: 43 },
        { timestamp: '2025-07-07', raw: 3461, dateNext: '2025-08-06', consumo: 43 },
        { timestamp: '2025-08-06', raw: 3500, dateNext: '2025-09-05', consumo: 39 },
        { timestamp: '2025-09-05', raw: 3534, dateNext: '2025-10-06', consumo: 34 },
        { timestamp: '2025-10-06', raw: 3574, dateNext: '2025-11-06', consumo: 40 },
        { timestamp: '2025-11-06', raw: 3616, dateNext: '2025-12-08', consumo: 42 },
        { timestamp: '2025-12-08', raw: 3658, dateNext: '2026-01-06', consumo: 42 },
        { timestamp: '2026-01-06', raw: 3700, dateNext: '2026-02-03', consumo: 42 },
        { timestamp: '2026-02-03', raw: 3742, dateNext: '2026-03-04', consumo: 42 },
        { timestamp: '2026-03-04', raw: 3783, dateNext: '2026-04-02', consumo: 41 },
        { timestamp: '2026-04-02', raw: 3825, dateNext: '2026-05-05', consumo: 42 }
    ];

    const entries = SEED.map((item, i) => ({
        id: 1000000 + i,
        timestamp: item.timestamp,
        raw: item.raw,
        kwh: item.raw * MULT10,
        dateNext: item.dateNext,
        expected: item.consumo * MULT10  // ex: 49 × 10 = 490 kWh
    }));

    db.set(SK_READINGS, entries);
}

// ─────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initPWA();
    initTabs();
    initDials();
    initCameraLeitura();
    initDateDefaults();
    initRegisterBtn();
    initImportFile();
    initModal();
    seedHistoricalData();   // ← popula histórico na 1ª abertura
    refresh();
});
