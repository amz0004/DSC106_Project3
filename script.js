const svg = d3.select("svg");
const width = window.innerWidth;
const height = window.innerHeight * 0.9;

const projection = d3.geoMercator()
    .center([-95, 37])
    .scale(900)
    .translate([width / 2, height / 2]);

const path = d3.geoPath().projection(projection);

Promise.all([
    d3.json("fires_year.geojson"),
    d3.json("https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson")
]).then(([fireData, world]) => {

    // --- MAP BACKGROUND ---
    svg.selectAll("path")
    .data(world.features)
    .enter()
    .append("path")
    .attr("d", path)
    .attr("fill", "#2e2e2eff")
    .attr("stroke", "#333");

    // --- PARSE AND SORT DATES ---
    fireData.features.forEach(d => {
    d.date = new Date(d.properties.ACQ_DATE);
    });
    fireData.features.sort((a, b) => a.date - b.date);

    // --- BRIGHTNESS + COLOR SCALES ---
    const brightnessExtent = d3.extent(fireData.features, d => d.properties.BRIGHTNESS);
    const brightnessScale = d3.scaleLinear().domain(brightnessExtent).range([1, 8]);
    const colorScale = d3.scaleSequential(d3.interpolateInferno).domain(brightnessExtent);

    // --- GROUP FIRES BY DAY ---
    const firesByDate = d3.group(fireData.features, d => d3.timeFormat("%Y-%m-%d")(d.date));
    const dates = Array.from(firesByDate.keys()).sort();

    // --- UI ELEMENTS ---
    const slider = d3.select("#timeSlider").attr("max", dates.length - 1);
    const dateLabel = d3.select("#dateLabel");
    const playPauseBtn = d3.select("#playPause");

    // --- LEGEND ---
    const legendCanvas = document.getElementById("legendCanvas");
    const ctx = legendCanvas.getContext("2d");
    const legendWidth = legendCanvas.width;
    for (let i = 0; i < legendWidth; i++) {
    const value = brightnessExtent[0] + (i / legendWidth) * (brightnessExtent[1] - brightnessExtent[0]);
    ctx.fillStyle = colorScale(value);
    ctx.fillRect(i, 0, 1, 12);
    }
    d3.select("#minB").text(brightnessExtent[0].toFixed(0));
    d3.select("#maxB").text(brightnessExtent[1].toFixed(0));

    // --- ANIMATION ---
    const pointsGroup = svg.append("g");
    let dayIndex = 0;
    let playing = true;

    function update(dayIndex) {
    const day = dates[dayIndex];
    const fires = firesByDate.get(day);
    if (!fires) return;

    dateLabel.text(day);
    const points = pointsGroup.selectAll("circle").data(fires, d => d.properties.id);

    // New fires appear and fade out only if playing
    const newPoints = points.enter()
        .append("circle")
        .attr("cx", d => projection(d.geometry.coordinates)[0])
        .attr("cy", d => projection(d.geometry.coordinates)[1])
        .attr("r", 0)
        .attr("fill", d => colorScale(d.properties.BRIGHTNESS))
        .attr("opacity", 0.7)
        .transition()
        .duration(3000)
        .attr("r", d => brightnessScale(d.properties.BRIGHTNESS));

    if (playing) {
        newPoints
        .transition()
        .duration(1200)
        .style("opacity", 0)
        .remove();
    }
    }

    function animate() {
    if (!playing) return;
    update(dayIndex);
    slider.property("value", dayIndex);
    dayIndex = (dayIndex + 1) % dates.length;
    setTimeout(animate, 200);
    }

    slider.on("input", function() {
    dayIndex = +this.value;
    update(dayIndex);
    });

    playPauseBtn.on("click", () => {
    playing = !playing;
    playPauseBtn.text(playing ? "⏸ Pause" : "▶ Play");
    if (playing) {
        animate();
    } else {
        // Stop any ongoing transitions (freeze current fires)
        svg.selectAll("circle").interrupt();
    }
    });

    animate();
});