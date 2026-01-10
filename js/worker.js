import { pipeline, env, cos_sim } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels = false;

// --- MODELOS ---
let transcriber = null;
let embedder = null;
let classifier = null;
let generator = null;

let vectorStore = []; 

// js/worker.js

// --- CAMBIO EN LOS PROMPTS PARA MEJORAR EL ESPAÑOL ---
const HATS = {
    'blanco': { 
        label: 'hechos y datos', 
        color: '#ecf0f1', 
        // TRUCO: Poner las cabeceras en español (Contexto/Pregunta/Respuesta) fuerza al modelo a seguir en español.
        prompt: 'Instrucción: Eres un asistente útil. Responde a la pregunta basándote SOLO en el contexto. Sé breve.\n\nContexto: {context}\n\nPregunta: {question}\n\nRespuesta en Español:' 
    },
    'rojo':   { 
        label: 'emociones y sentimientos', 
        color: '#e74c3c', 
        prompt: 'Tu tarea es reaccionar con intuición y sentimientos (sin justificar). \nPregunta: {question}\n\nReacción emocional en Español:' 
    },
    'negro':  { 
        label: 'riesgos y criticas', 
        color: '#95a5a6', 
        prompt: 'Tu tarea es ser crítico y pesimista. Señala los riesgos. \nPregunta: {question}\n\nCrítica en Español:' 
    },
    'amarillo':{ 
        label: 'beneficios y optimismo', 
        color: '#f1c40f', 
        prompt: 'Tu tarea es ser optimista. Señala los beneficios y el valor. \nPregunta: {question}\n\nBeneficios en Español:' 
    },
    'verde':  { 
        label: 'creatividad y alternativas', 
        color: '#2ecc71', 
        prompt: 'Tu tarea es proponer una idea creativa o alternativa. \nPregunta: {question}\n\nIdea creativa en Español:' 
    },
    'azul':   { 
        label: 'control y proceso', 
        color: '#3498db', 
        prompt: 'Tu tarea es organizar, resumir y definir los siguientes pasos. \nPregunta: {question}\n\nResumen y pasos en Español:' 
    }
};

self.addEventListener('message', async (event) => {
    const message = event.data;

    if (message.type === 'load') {
        try {
            self.postMessage({ status: 'loading', data: 'Cargando Whisper...' });
            transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', { quantized: true });
            
            self.postMessage({ status: 'loading', data: 'Cargando RAG...' });
            embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });

            self.postMessage({ status: 'loading', data: 'Cargando Agentes...' });
            classifier = await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli', { quantized: true });
            generator = await pipeline('text2text-generation', 'Xenova/LaMini-Flan-T5-248M', { quantized: true });

            self.postMessage({ status: 'ready', data: 'SISTEMA LISTO V2.0 🚀' });
        } catch (error) {
            self.postMessage({ status: 'error', data: error.message });
        }
    }

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
                'facts data numbers': 'blanco',
                'emotional feeling reaction': 'rojo',
                'risks criticism negative': 'negro',
                'benefits positive value': 'amarillo',
                'creative ideas new': 'verde',
                'summary process control': 'azul'
            };
            
            const classification = await classifier(text, Object.keys(intentMap));
            let selectedHat = intentMap[classification.labels[0]];

            // Forzar Blanco si es pregunta
            if (text.includes('?') || text.match(/cu(á|a)l|qu(é|e)|d(ó|o)nde|c(ó|o)mo|cu(á|a)nto/i)) {
                selectedHat = 'blanco';
            }

            self.postMessage({ status: 'info', data: `Sombrero: ${selectedHat.toUpperCase()}` });

            // C. RAG (Búsqueda)
            let context = "";
            if (vectorStore.length > 0) {
                 const queryEmbedding = await embedder(text, { pooling: 'mean', normalize: true });
                 const results = vectorStore.map(doc => ({ 
                     text: doc.text, 
                     score: cos_sim(queryEmbedding.data, doc.embedding) 
                 }));
                 
                 results.sort((a, b) => b.score - a.score);
                 
                 // CAMBIO AQUÍ: Cogemos 5 trozos en lugar de 3 para asegurar que entra el dato
                 context = results.slice(0, 5).map(r => r.text).join(' ... ');
                 
                 // IMPORTANTE: Mira esto en la consola (F12) para ver si encuentra el texto "3 minutos"
                 console.log("Contexto recuperado:", context); 
            }

            // D. Generar
            const promptTemplate = HATS[selectedHat].prompt;
            const finalPrompt = promptTemplate.replace('{context}', context).replace('{question}', text);

            const response = await generator(finalPrompt, {
                max_new_tokens: 100,
                temperature: 0.1,
                repetition_penalty: 1.2
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

    if (message.type === 'add-document') {
        if (!embedder) return;
        // Usamos la nueva función de split mejorada
        const chunks = splitTextRecursive(message.text, 500, 50); 
        vectorStore = [];
        for (const chunk of chunks) {
            const output = await embedder(chunk, { pooling: 'mean', normalize: true });
            vectorStore.push({ text: chunk, embedding: output.data });
        }
        self.postMessage({ status: 'rag-ready', data: `PDF Procesado: ${chunks.length} fragmentos.` });
    }
});

// --- NUEVA FUNCIÓN DE TEXT SPLITTER ---
// Divide por caracteres fijos con solapamiento (overlap)
// Esto evita cortar frases a la mitad en el borde del chunk
function splitTextRecursive(text, chunkSize = 500, overlap = 50) {
    const chunks = [];
    for (let i = 0; i < text.length; i += (chunkSize - overlap)) {
        chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
}