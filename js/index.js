// js/index.js

// --- 1. CONFIGURACIÓN INICIAL ---
const btnRecord = document.getElementById('btn-record');
const transcriptionOutput = document.getElementById('transcription-output');
const pdfZone = document.querySelector('.contenedor-pdf');

// Inicializamos el Worker
const worker = new Worker('js/worker.js', { type: 'module' });

let isRecording = false;
let audioContext = null;
let audioChunks = []; // Buffer temporal

// --- 2. GESTIÓN DE MENSAJES DEL WORKER (CEREBRO) ---
worker.onmessage = (e) => {
    const { status, data, hat, color, text } = e.data;

    // A. Mensajes de Estado (Carga de modelos)
    if (status === 'loading') {
        console.log(`[Cargando] ${data}`);
        transcriptionOutput.innerHTML += `<div style="color: yellow; font-size: 0.8em;">Wait: ${data}</div>`;
    } 
    else if (status === 'ready') {
        console.log(`[Listo] ${data}`);
        transcriptionOutput.innerHTML += `<div style="color: #2ecc71; font-weight:bold; font-size: 0.8em;">System: ${data}</div>`;
        btnRecord.disabled = false;
    } 
    else if (status === 'info') {
        // Mensajes internos (ej: "Detectado Sombrero Negro")
        transcriptionOutput.innerHTML += `<div style="color: #aaa; font-style:italic; font-size: 0.8em;">System: ${data}</div>`;
        transcriptionOutput.scrollTop = transcriptionOutput.scrollHeight;
    }
    
    // B. Transcripción (Lo que dice el usuario)
    else if (status === 'complete') {
        transcriptionOutput.innerHTML += `<p style="margin-top:10px;"><strong>👤 Usuario:</strong> ${data}</p>`;
        transcriptionOutput.scrollTop = transcriptionOutput.scrollHeight;
    }

    // C. Respuesta del Agente (SOMBREROS)
    else if (status === 'agent-response') {
        // Mapeo de iconos
        const icons = {
            'blanco': '⚪', 'rojo': '🔴', 'negro': '⚫', 
            'amarillo': '🟡', 'verde': '🟢', 'azul': '🔵'
        };

        // Crear la tarjeta visual
        const cardHtml = `
            <div style="
                background-color: ${color}; 
                color: ${hat === 'amarillo' || hat === 'blanco' ? '#000' : '#fff'}; 
                padding: 15px; 
                border-radius: 12px; 
                margin-top: 10px; 
                margin-bottom: 10px;
                box-shadow: 0 4px 10px rgba(0,0,0,0.3);
                border-left: 8px solid rgba(0,0,0,0.2);
                animation: fadeIn 0.5s;
            ">
                <div style="font-weight: bold; font-size: 0.9em; text-transform: uppercase; margin-bottom: 5px; opacity: 0.9;">
                    ${icons[hat] || '🤖'} Sombrero ${hat}
                </div>
                <div style="font-size: 1.1em; line-height: 1.4;">
                    ${text}
                </div>
            </div>
        `;

        transcriptionOutput.innerHTML += cardHtml;
        transcriptionOutput.scrollTop = transcriptionOutput.scrollHeight;

        // Opcional: Mostrar también en la caja inferior grande
        const chatBoxInferior = document.querySelector('.fila-inferior');
        if (chatBoxInferior) {
            chatBoxInferior.innerHTML = cardHtml;
            chatBoxInferior.style.background = 'transparent';
        }
    }

    // D. Confirmación de PDF
    else if (status === 'rag-ready') {
        transcriptionOutput.innerHTML += `<div style="color: cyan; font-size: 0.8em;">System: ${data}</div>`;
    }
    
    else if (status === 'error') {
        console.error(data);
        transcriptionOutput.innerHTML += `<div style="color: red;">Error: ${data}</div>`;
    }
};

// Iniciar la carga al abrir
worker.postMessage({ type: 'load' });
btnRecord.disabled = true;

// --- 3. LÓGICA DE AUDIO (WHISPER) ---
btnRecord.addEventListener('click', async () => {
    if (!isRecording) startRecording();
    else stopRecording();
});

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);

        source.connect(processor);
        processor.connect(audioContext.destination);

        let audioData = [];
        processor.onaudioprocess = (e) => {
            if (!isRecording) return;
            audioData.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        };

        window.currentStream = stream;
        window.currentProcessor = processor;
        window.currentSource = source;
        window.currentAudioData = audioData;

        isRecording = true;
        btnRecord.textContent = "🛑 Detener y Pensar";
        btnRecord.style.backgroundColor = "#c0392b"; // Rojo oscuro
    } catch (err) {
        alert("Error de micrófono: " + err.message);
    }
}

async function stopRecording() {
    isRecording = false;
    btnRecord.textContent = "⏳ Procesando...";
    btnRecord.disabled = true;

    // Limpieza de audio
    if (window.currentStream) window.currentStream.getTracks().forEach(t => t.stop());
    if (window.currentProcessor) window.currentProcessor.disconnect();
    if (window.currentSource) window.currentSource.disconnect();
    if (audioContext) await audioContext.close();

    // Unir buffers
    const rawAudio = mergeBuffers(window.currentAudioData);
    
    // Enviar al Worker
    worker.postMessage({ type: 'generate', audio: rawAudio });

    btnRecord.textContent = "🎤 Iniciar Grabación";
    btnRecord.disabled = false;
    btnRecord.style.backgroundColor = "#e74c3c";
}

function mergeBuffers(audioData) {
    let totalLength = 0;
    audioData.forEach(chunk => totalLength += chunk.length);
    const result = new Float32Array(totalLength);
    let offset = 0;
    audioData.forEach(chunk => {
        result.set(chunk, offset);
        offset += chunk.length;
    });
    return result;
}

// --- 4. LÓGICA DE PDF (RAG) ---
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    pdfZone.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
});

pdfZone.addEventListener('dragover', () => pdfZone.style.border = '2px dashed #3498db');
pdfZone.addEventListener('dragleave', () => pdfZone.style.border = 'none');

pdfZone.addEventListener('drop', async (e) => {
    pdfZone.style.border = 'none';
    const files = e.dataTransfer.files;
    
    if (files.length > 0 && files[0].type === 'application/pdf') {
        pdfZone.innerHTML = "⏳ Leyendo PDF...";
        try {
            const text = await extractTextFromPDF(files[0]);
            worker.postMessage({ type: 'add-document', text: text });
            pdfZone.innerHTML = `✅ ${files[0].name}`;
        } catch (err) {
            pdfZone.innerHTML = "❌ Error al leer PDF";
            console.error(err);
        }
    }
});

async function extractTextFromPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(item => item.str).join(' ') + "\n";
    }
    return fullText;
}