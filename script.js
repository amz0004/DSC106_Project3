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

  // --- BRIGHTNESS BY MONTH CHART ---
  const chartSvg = d3.select('#chartSvg');
  const chartMargin = {top: 18, right: 12, bottom: 28, left: 36};
  const chartWidth = +chartSvg.attr('width') - chartMargin.left - chartMargin.right;
  const chartHeight = +chartSvg.attr('height') - chartMargin.top - chartMargin.bottom;
  const chartG = chartSvg.append('g').attr('transform', `translate(${chartMargin.left},${chartMargin.top})`);

  function computeMonthlyAvg(dataset) {
    const counts = new Array(12).fill(0);
    const sums = new Array(12).fill(0);
    dataset.forEach(d => {
      const p = d.properties || {};
      const b = +p.BRIGHTNESS;
      const date = new Date(p.ACQ_DATE);
      if (!isNaN(b) && !isNaN(date)) {
        const m = date.getMonth();
        sums[m] += b;
        counts[m] += 1;
      }
    });
    return sums.map((s, i) => counts[i] ? s / counts[i] : null);
  }

  // initial monthly averages from full fireData
  const monthlyAvg = computeMonthlyAvg(fireData.features);

  // scales
  const x = d3.scalePoint().domain(d3.range(0,12)).range([0, chartWidth]).padding(0.5);
  const y = d3.scaleLinear().domain([d3.min(monthlyAvg.filter(d=>d!=null)) || 300, d3.max(monthlyAvg.filter(d=>d!=null)) || 340]).nice().range([chartHeight, 0]);

  // axes
  const xAxis = d3.axisBottom(x).tickFormat(i => (i+1)); // months 1..12
  const yAxis = d3.axisLeft(y).ticks(3);

  // add title
  chartSvg.append('text')
    .attr('class', 'chart-title')
    .attr('x', +chartSvg.attr('width') - 100)
    .attr('y', 10)
    .attr('text-anchor', 'end')
    .text('Avg Brightness by Month');

  // draw axes
  chartG.append('g').attr('class','chart-axis x-axis').attr('transform', `translate(0,${chartHeight})`).call(xAxis);
  chartG.append('g').attr('class','chart-axis y-axis').call(yAxis);

  // x-axis label
  chartG.append('text')
    .attr('class','axis-label')
    .attr('x', chartWidth / 2)
    .attr('y', chartHeight + 28)
    .attr('text-anchor','middle')
    .text('month');

  // y-axis label
  chartG.append('text')
    .attr('class','axis-label')
    .attr('transform', `translate(-28,${chartHeight/2}) rotate(-90)`)
    .attr('text-anchor','middle')
    .text('Brightness');

  // overlay rects for each month (for highlights)
  const monthRects = chartG.selectAll('.month-rect').data(d3.range(0,12)).enter()
    .append('rect')
    .attr('class','month-rect hidden')
    .attr('x', d => x(d) - (chartWidth/12)/2 )
    .attr('y', 0)
    .attr('width', (chartWidth/12))
    .attr('height', chartHeight)
    .style('pointer-events','none');

  // line and points
  const line = d3.line()
    .defined((d,i) => monthlyAvg[i] != null)
    .x((d,i) => x(i))
    .y((d,i) => y(monthlyAvg[i]));

  chartG.append('path').datum(monthlyAvg).attr('class','chart-line').attr('d', line);
  // points
  chartG.selectAll('.chart-point').data(monthlyAvg.map((v,i)=>({v,i}))).enter()
    .append('circle')
    .attr('class','chart-point')
    .attr('cx', d => x(d.i))
    .attr('cy', d => (d.v!=null ? y(d.v) : -10))
    .attr('r', 3);

  // helper to update which month rects are visible based on selected seasons
  function updateChartHighlights(selectedSeasons) {
    const monthsSet = new Set();
    selectedSeasons.forEach(s => { if (seasons[s]) seasons[s].forEach(m => monthsSet.add(m)); });
    // for each rect, toggle class hidden and set color based on monthly average when available
    chartG.selectAll('.month-rect').each(function(d,i) {
      const rect = d3.select(this);
      if (monthsSet.has(i)) {
        rect.classed('hidden', false);
        const avg = monthlyAvg[i];
        if (avg != null && typeof colorScale === 'function') {
          rect.style('fill', colorScale(avg)).style('opacity', 0.16);
        } else {
          rect.style('fill', 'steelblue').style('opacity', 0.12);
        }
      } else {
        rect.classed('hidden', true);
      }
    });
  }

  // initialize with no highlight (or with currently checked seasons)
  const initialSeasons = Array.from(document.querySelectorAll('.season:checked')).map(cb => cb.value);
  updateChartHighlights(initialSeasons);

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
    if (typeof updateChartHighlights === 'function') updateChartHighlights(selectedSeasons);
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
