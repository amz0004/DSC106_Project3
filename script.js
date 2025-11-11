const svg = d3.select("svg");
const width = window.innerWidth;
const height = window.innerHeight;
svg.attr("width", width).attr("height", height);

const projection = d3.geoAlbersUsa()
  .translate([width / 2, height / 2])
  .scale([1200]);

const path = d3.geoPath().projection(projection);

Promise.all([
  d3.json("fires_year.geojson"),
  d3.json("us-states.json")
]).then(([fireData, states]) => {

  // --- DRAW STATES ---
  svg.selectAll("path")
    .data(states.features)
    .enter()
    .append("path")
    .attr("d", path)
    .attr("fill", "#1b1b1b")
    .attr("stroke", "#333");

  // --- DEFINE SEASONS ---
  const seasons = {
    "Winter": [10, 11, 0], // Nov, Dec, Jan
    "Spring": [1, 2, 3],   // Feb, Mar, Apr
    "Summer": [4, 5, 6],   // May, Jun, Jul
    "Fall": [7, 8, 9]      // Aug, Sep, Oct
  };

  // --- FILTER FIRE DATA FOR BRIGHTNESS 325-400 ---
  const filteredFireData = fireData.features.filter(d => d.properties.BRIGHTNESS >= 325);

  // --- BRIGHTNESS + COLOR ---
  const brightnessScale = d3.scaleLinear().domain([325, 510]).range([2, 8]);
  const colorScale = d3.scaleSequential(d3.interpolateRgb("red", "yellow")).domain([325, 510]);
  // --- ADD FIRES ---
  const pointsGroup = svg.append("g");

  function updateFires() {
    const selectedSeasons = Array.from(document.querySelectorAll(".season:checked")).map(cb => cb.value);
    const minBrightness = +document.getElementById("brightnessSlider").value;

    const firesToShow = filteredFireData.filter(d => {
      const month = new Date(d.properties.ACQ_DATE).getMonth();
      const inSelectedSeason = selectedSeasons.some(s => seasons[s].includes(month));
      return inSelectedSeason && d.properties.BRIGHTNESS >= minBrightness;
    });

    const points = pointsGroup.selectAll("circle").data(firesToShow, d => d.properties.id);

    // EXIT
    points.exit().remove();

    // ENTER
    points.enter()
      .append("circle")
      .attr("cx", d => projection(d.geometry.coordinates)[0])
      .attr("cy", d => projection(d.geometry.coordinates)[1])
      .attr("r", 0)
      .attr("fill", d => colorScale(d.properties.BRIGHTNESS))
      .attr("opacity", 0.7)
      .transition()
      .duration(500)
      .attr("r", d => brightnessScale(d.properties.BRIGHTNESS));

    // UPDATE
    points.transition()
      .duration(500)
      .attr("cx", d => projection(d.geometry.coordinates)[0])
      .attr("cy", d => projection(d.geometry.coordinates)[1])
      .attr("r", d => brightnessScale(d.properties.BRIGHTNESS))
      .attr("fill", d => colorScale(d.properties.BRIGHTNESS));
  }

  // --- FILTER EVENTS ---
  document.querySelectorAll(".season").forEach(cb => cb.addEventListener("change", updateFires));
  document.getElementById("brightnessSlider").addEventListener("input", e => {
    document.getElementById("brightnessValue").textContent = e.target.value;
    updateFires();
  });

  updateFires(); // initial render
});
