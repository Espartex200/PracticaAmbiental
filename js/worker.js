import { pipeline, env, cos_sim } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels = false;

// --- VARIABLES GLOBALES ---
let transcriber = null;
let embedder = null;
let classifier = null;
let generator = null; 

let vectorStore = []; 

// --- SOMBREROS (Configuración para LaMini CPU) ---
// A LaMini (T5) le gusta el formato: "Question: ... Context: ... Answer:"
const HATS = {
    'blanco': { 
        label: 'hechos y datos', 
        color: '#ecf0f1', 
        // CAMBIO CLAVE: Formato muy estricto en inglés (que entiende mejor) para forzar respuesta corta
        prompt: 'Question: "{question}"? \nContext: "{context}" \nAnswer (in Spanish):' 
    },
    'rojo':   { 
        label: 'emociones', 
        color: '#e74c3c', 
        prompt: 'Task: Express feelings about this. Input: "{question}". \nReaction (in Spanish):' 
    },
    'negro':  { 
        label: 'crítica', 
        color: '#95a5a6', 
        prompt: 'Task: Criticize this idea. Input: "{question}". \nCritique (in Spanish):' 
    },
    'amarillo':{ 
        label: 'optimismo', 
        color: '#f1c40f', 
        prompt: 'Task: Say something positive. Input: "{question}". \nBenefit (in Spanish):' 
    },
    'verde':  { 
        label: 'creatividad', 
        color: '#2ecc71', 
        prompt: 'Task: Create a new idea. Input: "{question}". \nIdea (in Spanish):' 
    },
    'azul':   { 
        label: 'control', 
        color: '#3498db', 
        prompt: 'Task: Summarize. Input: "{question}". \nSummary (in Spanish):' 
    }
};

self.addEventListener('message', async (event) => {
    const message = event.data;

    // --- 1. CARGA DE MODELOS ---
    if (message.type === 'load') {
        try {
            self.postMessage({ status: 'loading', data: 'Cargando Whisper...' });
            transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', { quantized: true });
            
            self.postMessage({ status: 'loading', data: 'Cargando RAG...' });
            embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });

            self.postMessage({ status: 'loading', data: 'Cargando Clasificador...' });
            classifier = await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli', { quantized: true });
            
            // USAMOS LAMINI (CPU) - Tarea text2text-generation
            self.postMessage({ status: 'loading', data: 'Cargando Generador (LaMini)...' });
            generator = await pipeline('text2text-generation', 'Xenova/LaMini-Flan-T5-248M', { quantized: true });

            self.postMessage({ status: 'ready', data: 'SISTEMA LISTO (CPU V3) 🚀' });
        } catch (error) {
            self.postMessage({ status: 'error', data: error.message });
        }
    }

    // --- 2. GENERACIÓN ---
    if (message.type === 'generate') {
        if (!transcriber) return;
        try {
            // A. Transcribir
            const output = await transcriber(message.audio, { language: 'spanish', task: 'transcribe' });
            const text = output.text;
            self.postMessage({ status: 'complete', data: text });

            if (text.trim().length < 2) return;

            // B. Clasificar
            const intentMap = {
                'facts data': 'blanco', 'emotional': 'rojo', 'risks': 'negro',
                'benefits': 'amarillo', 'creative': 'verde', 'summary': 'azul'
            };
            const classification = await classifier(text, Object.keys(intentMap));
            let selectedHat = intentMap[classification.labels[0]];
            if (text.match(/\?|cu(á|a)l|d(ó|o)nde|c(ó|o)mo|cu(á|a)nto/i)) selectedHat = 'blanco';

            self.postMessage({ status: 'info', data: `Sombrero: ${selectedHat.toUpperCase()}` });

            // C. RAG (Contexto)
            let context = "";
            if (vectorStore.length > 0) {
                 const queryEmbedding = await embedder(text, { pooling: 'mean', normalize: true });
                 const results = vectorStore.map(doc => ({ 
                     text: doc.text, score: cos_sim(queryEmbedding.data, doc.embedding) 
                 }));
                 results.sort((a, b) => b.score - a.score);
                 
                 // Limpieza agresiva: quitamos saltos de línea para que T5 no se líe
                 context = results.slice(0, 3).map(r => r.text.replace(/(\r\n|\n|\r)/gm, " ")).join(' ... ');
                 console.log("Contexto RAG:", context);
            }

            // D. Generar
            const promptTemplate = HATS[selectedHat].prompt;
            const finalPrompt = promptTemplate.replace('{context}', context).replace('{question}', text);

            const response = await generator(finalPrompt, {
                max_new_tokens: 100,
                temperature: 0.1, // Mínima creatividad para que no invente
                repetition_penalty: 1.5 // Penalización alta para que no repita bucles
            });

            self.postMessage({ 
                status: 'agent-response', 
                hat: selectedHat, 
                color: HATS[selectedHat].color,
                text: response[0].generated_text 
            });

        } catch (error) {
            self.postMessage({ status: 'error', data: error.message });
        }
    }

    // --- 3. PROCESAR PDF ---
    if (message.type === 'add-document') {
        if (!embedder) return;
        const chunks = splitTextRecursive(message.text, 500, 50); 
        vectorStore = [];
        for (const chunk of chunks) {
            const output = await embedder(chunk, { pooling: 'mean', normalize: true });
            vectorStore.push({ text: chunk, embedding: output.data });
        }
        self.postMessage({ status: 'rag-ready', data: `PDF Procesado: ${chunks.length} fragmentos.` });
    }
});

function splitTextRecursive(text, chunkSize = 500, overlap = 50) {
    const chunks = [];
    for (let i = 0; i < text.length; i += (chunkSize - overlap)) { chunks.push(text.slice(i, i + chunkSize)); }
    return chunks;
}