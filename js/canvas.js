const canvas = document.querySelector("#canvas");
const ctx = canvas.getContext("2d");
const btnsColor = document.querySelectorAll(".btn-circular[data-color]");
const btnEraser = document.getElementById("btnBorrador")
const sliderLineWidth = document.getElementById("sliderControl")
const CANVAS_BACKGROUND_COLOR = "#ffffff";

let rect = canvas.getBoundingClientRect();
let painting = false;

// Initial configuration
canvas.style.backgroundColor = CANVAS_BACKGROUND_COLOR;
ctx.strokeStyle = CANVAS_BACKGROUND_COLOR;
ctx.lineWidth = sliderLineWidth.value;
ctx.lineCap = "round";
ctx.lineJoin = "round";

// Functions
function adjustCanvas(){
    // console.log("Adjusting canvas")
    // canvas.width = canvas.offsetWidth;
    // canvas.Height = canvas.offsetHeight;
    // rect = canvas.getBoundingClientRect()

    rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    ctx.scale(dpr, dpr);
}
function startPosition(e){
    painting = true;
    draw(e);
}
function finishedPosition(){
    painting = false;
    ctx.beginPath();
}
function draw(e){
    if(!painting) return;
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
}

//Event Listeners
window.addEventListener("resize", adjustCanvas);
canvas.addEventListener("mousedown", startPosition);
canvas.addEventListener("mouseup", finishedPosition);
canvas.addEventListener("mousemove", draw);

// Buttons
btnsColor.forEach(btn => {
    btn.addEventListener("click", ()=>{
        ctx.strokeStyle = btn.getAttribute('data-color');

        // Highlight only pressed button
        btnsColor.forEach(b => b.style.transform="scale(1)");
        btnEraser.style.transform = "scale(1)";
        btn.style.transform = "scale(1.2)";
    })
})

btnEraser.addEventListener('click', () => {
        ctx.strokeStyle = CANVAS_BACKGROUND_COLOR;    
        btnsColor.forEach(b => b.style.transform = "scale(1)");
        btnEraser.style.transform = "scale(1.2)";
    });

sliderLineWidth.addEventListener("input", ()=>{
    ctx.lineWidth = sliderLineWidth.value;
    console.log(ctx.lineWidth);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

})

adjustCanvas();