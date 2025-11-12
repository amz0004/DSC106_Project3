const svg = d3.select("svg");
const width = window.innerWidth;
const height = window.innerHeight;
svg.attr("width", width).attr("height", height);

// Dropdown toggle behavior for season filters
const dropdownToggle = document.querySelector('.dropdown-toggle');
const dropdownPanel = document.getElementById('seasonPanel');
const seasonDropdown = document.getElementById('seasonDropdown');
if (dropdownToggle && dropdownPanel && seasonDropdown) {
  dropdownToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const expanded = dropdownToggle.getAttribute('aria-expanded') === 'true';
    dropdownToggle.setAttribute('aria-expanded', String(!expanded));
    dropdownPanel.hidden = expanded;
    dropdownToggle.classList.toggle('open', !expanded);
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!seasonDropdown.contains(e.target)) {
      dropdownPanel.hidden = true;
      dropdownToggle.setAttribute('aria-expanded', 'false');
      dropdownToggle.classList.remove('open');
    }
  });
}

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

  // Tooltip element
  const tooltipEl = document.getElementById('tooltip');
  function formatDateString(acqDate, acqTime) {
    let datePart = '';
    const d = new Date(acqDate);
    if (!isNaN(d)) {
      datePart = d.toLocaleDateString();
    } else {
      datePart = String(acqDate || '');
    }
    if (acqTime != null && acqTime !== '') {
      const t = String(acqTime).padStart(4, '0');
      const hh = t.slice(0, 2);
      const mm = t.slice(2, 4);
      if (!isNaN(parseInt(hh)) && !isNaN(parseInt(mm))) {
        return `${datePart} ${hh}:${mm}`;
      }
    }
    if (!isNaN(d)) {
      return datePart + ' ' + d.toLocaleTimeString();
    }
    return datePart;
  }

  function showTooltip(event, d) {
    if (!tooltipEl) return;
    const props = d.properties || {};
    const brightness = props.BRIGHTNESS != null ? props.BRIGHTNESS : 'N/A';
    const dateStr = props.ACQ_DATE ? formatDateString(props.ACQ_DATE, props.ACQ_TIME) : 'unknown';
    const daynightRaw = props.DAYNIGHT || props.DAY_NIGHT || props.DAY || '';
    const daynight = (''+daynightRaw).toUpperCase() === 'N' ? 'Night' : ((''+daynightRaw).toUpperCase() === 'D' ? 'Day' : (daynightRaw || 'Unknown'));
    tooltipEl.innerHTML = `
      <div class="line"><span class="label">Brightness:</span><strong>${typeof brightness === 'number' ? brightness.toFixed(2) : brightness}</strong></div>
      <div class="line"><span class="label">Date:</span>${dateStr}</div>
      <div class="line"><span class="label">Detected:</span>${daynight}</div>
    `;
    tooltipEl.classList.add('visible');
    tooltipEl.setAttribute('aria-hidden', 'false');
    moveTooltip(event);
  }

  function moveTooltip(event) {
    if (!tooltipEl) return;
    const padding = 12;
    let x = event.pageX + padding;
    let y = event.pageY + padding;
    const rect = tooltipEl.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    if (x + rect.width > winW - 8) {
      x = event.pageX - rect.width - padding;
    }
    if (y + rect.height > winH - 8) {
      y = event.pageY - rect.height - padding;
    }
    tooltipEl.style.left = x + 'px';
    tooltipEl.style.top = y + 'px';
  }

  function hideTooltip() {
    if (!tooltipEl) return;
    tooltipEl.classList.remove('visible');
    tooltipEl.setAttribute('aria-hidden', 'true');
  }

  // --- TITLE UPDATING (based on selected seasons) ---
  const titleEl = document.querySelector('.title');
  const allYears = fireData.features.map(d => new Date(d.properties.ACQ_DATE).getFullYear()).filter(y => !isNaN(y));
  const latestYear = allYears.length ? Math.max(...allYears) : (new Date()).getFullYear();
  const orderedMonths = [10,11,0,1,2,3,4,5,6,7,8,9]; // Nov -> Oct ordering
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  function updateTitle(selectedSeasons) {
    if (!titleEl) return;
    if (!selectedSeasons) selectedSeasons = Array.from(document.querySelectorAll('.season:checked')).map(cb => cb.value);
    const monthsSet = new Set();
    selectedSeasons.forEach(s => {
      if (seasons[s]) seasons[s].forEach(m => monthsSet.add(m));
    });
    if (monthsSet.size === 0) {
      titleEl.textContent = 'US Fires (no seasons selected)';
      return;
    }
    const selectedOrderedIndexes = Array.from(monthsSet).map(m => orderedMonths.indexOf(m)).filter(i => i >= 0);
    const minIdx = Math.min(...selectedOrderedIndexes);
    const maxIdx = Math.max(...selectedOrderedIndexes);
    const startMonth = orderedMonths[minIdx];
    const endMonth = orderedMonths[maxIdx];
    const startYear = startMonth >= 10 ? latestYear - 1 : latestYear;
    const endYear = endMonth >= 10 ? latestYear - 1 : latestYear;
    const startName = monthNames[startMonth];
    const endName = monthNames[endMonth];
    titleEl.textContent = `US Fires from ${startName} ${startYear} to ${endName} ${endYear}`;
  }

  // Slider elements for thumb color syncing
  const brightnessControl = document.getElementById('brightnessControl');
  const brightnessSlider = document.getElementById('brightnessSlider');
  const brightnessValueEl = document.getElementById('brightnessValue');
  function setSliderThumbColor(val) {
    if (!brightnessControl || typeof colorScale !== 'function') return;
    brightnessControl.style.setProperty('--thumb-color', colorScale(+val));
  }

  function updateFires() {
    const selectedSeasons = Array.from(document.querySelectorAll(".season:checked")).map(cb => cb.value);
    updateTitle(selectedSeasons);
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
      .on('mouseover', (event, d) => showTooltip(event, d))
      .on('mousemove', (event, d) => moveTooltip(event, d))
      .on('mouseout', () => hideTooltip())
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

    // ensure existing circles also have tooltip handlers
    pointsGroup.selectAll('circle')
      .on('mouseover', (event, d) => showTooltip(event, d))
      .on('mousemove', (event, d) => moveTooltip(event, d))
      .on('mouseout', () => hideTooltip());
  }

  // --- FILTER EVENTS ---
  document.querySelectorAll(".season").forEach(cb => cb.addEventListener("change", updateFires));
  if (brightnessSlider) {
    // initialize thumb color
    setSliderThumbColor(brightnessSlider.value);

    brightnessSlider.addEventListener("input", e => {
      const v = e.target.value;
      if (brightnessValueEl) brightnessValueEl.textContent = v;
      setSliderThumbColor(v);
      updateFires();
    });
  }

  updateFires(); // initial render
});
