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

  // --- DRAW GRATITCULE (longitude/latitude grid) ---
  // draw a subtle graticule behind the states and points. Step can be adjusted to 5 or 10 degrees.
  const graticule = d3.geoGraticule().step([10, 10]); // [lonStep, latStep] in degrees
  svg.append('g')
    .attr('class', 'graticule-group')
    .append('path')
    .datum(graticule())
    .attr('class', 'graticule')
    .attr('d', path);

  // Add graticule tick labels (lon across top/bottom, lat at left/right)
  // We'll compute tick positions by projecting representative points and place labels at the SVG edges.
  const gLabels = svg.append('g').attr('class', 'graticule-labels');
  const lonStep = 10; // degrees
  const latStep = 10;
  const lonTicks = d3.range(-180, 181, lonStep);
  const latTicks = d3.range(-90, 91, latStep);

  // place longitude labels along the top if projection yields valid x
  lonTicks.forEach(lon => {
    // pick a central latitude for label placement (approx center of projection): 40N
    const pt = projection([lon, 40]);
    if (pt && isFinite(pt[0]) && pt[0] >= 0 && pt[0] <= width) {
      gLabels.append('text')
        .attr('class', 'graticule-label lon')
        .attr('x', pt[0])
        .attr('y', 14)
        .text(`${lon}°`);
    }
  });

  // place latitude labels along the left edge if projection yields valid y
  latTicks.forEach(lat => {
    // pick a central longitude for label placement (approx center of US): -95
    const pt = projection([-95, lat]);
    if (pt && isFinite(pt[1]) && pt[1] >= 0 && pt[1] <= height) {
      gLabels.append('text')
        .attr('class', 'graticule-label lat')
        .attr('x', 8)
        .attr('y', pt[1] + 4)
        .text(`${lat}°`);
    }
  });

  // --- INSET BOXES FOR ALASKA & HAWAII ---
  // Draw a subtle rounded rect behind each inset state and clip a finer graticule into it
  function addInsetBox(stateName, clipId, step) {
    const feature = states.features.find(s => s.properties && s.properties.NAME === stateName);
    if (!feature) return;
    // compute projected bounds for placement of the inset box
    const b = path.bounds(feature); // [[x0,y0],[x1,y1]]
    const pad = 8;
    const x = b[0][0] - pad;
    const y = b[0][1] - pad;
    const w = (b[1][0] - b[0][0]) + pad * 2;
    const h = (b[1][1] - b[0][1]) + pad * 2;

    const inset = svg.append('g').attr('class', `inset-${stateName.replace(/\s+/g,'-').toLowerCase()}`);
    // clip path (in screen/projected coordinates)
    inset.append('clipPath').attr('id', clipId)
      .append('rect').attr('x', x).attr('y', y).attr('width', w).attr('height', h);
    // background box (covers any underlying global graticule)
    inset.append('rect')
      .attr('class', 'inset-box')
      .attr('x', x)
      .attr('y', y)
      .attr('width', w)
      .attr('height', h)
      .attr('rx', 6);

    // --- create a graticule limited to the geographic bbox of the state ---
    // Use geoBounds to get lon/lat extent and build a graticule only inside that extent
    const geoB = d3.geoBounds(feature); // [[minLon,minLat],[maxLon,maxLat]]
    const padDeg = 1; // small padding in degrees so lines just outside the state are included
    const extent = [
      [geoB[0][0] - padDeg, geoB[0][1] - padDeg],
      [geoB[1][0] + padDeg, geoB[1][1] + padDeg]
    ];
    const smallGraticule = d3.geoGraticule().extent(extent).step([step, step]);

    // append graticule path but clip to the inset rectangle just in case
    inset.append('path')
      .datum(smallGraticule())
      .attr('class', 'inset-graticule')
      .attr('d', path)
      .attr('clip-path', `url(#${clipId})`);
  }

  addInsetBox('Alaska', 'clip-ak', 10);
  addInsetBox('Hawaii', 'clip-hi', 10);

  // state selection set (names)
  const selectedStates = new Set();

  // reset-selection button (hidden until selection made)
  const resetBtn = d3.select('body').append('button')
    .attr('id', 'resetSelectionBtn')
    .text('Reset selection')
    .style('position', 'fixed')
    .style('left', '12px')
    .style('bottom', '12px')
    .style('padding', '8px 10px')
    .style('background', 'rgba(0,0,0,0.6)')
    .style('color', '#fff')
    .style('border', '1px solid rgba(255,255,255,0.08)')
    .style('border-radius', '6px')
    .style('box-shadow', '0 6px 18px rgba(0,0,0,0.4)')
    .style('display', 'none')
    .on('click', () => {
      selectedStates.clear();
      updateStateStyles();
      updateFires();
      resetBtn.style('display', 'none');
    });


  // --- DRAW STATES ---
  // create a dedicated group for state paths so we don't accidentally bind to
  // other <path> elements (graticules, inset paths, etc.) that were appended earlier
  const statesG = svg.append('g').attr('class', 'states-group');
  // draw state paths and attach click handlers for selection
  const statePaths = statesG.selectAll('path')
    .data(states.features)
    .enter()
    .append('path')
    .attr('d', path)
    .attr('fill', '#1b1b1b')
    .attr('stroke', '#333')
    .style('cursor', 'pointer')
    .on('click', function(event, d) {
      // toggle selection
      event.stopPropagation();
      const name = d.properties && d.properties.NAME;
      if (!name) return;
      if (selectedStates.has(name)) {
        selectedStates.delete(name);
      } else {
        selectedStates.add(name);
      }
      updateStateStyles();
      // show/hide reset button
      if (selectedStates.size > 0) resetBtn.style('display', 'block');
      else resetBtn.style('display', 'none');
      // update points shown
      updateFires();
    });

  function updateStateStyles() {
    statesG.selectAll('path').attr('fill', d => (d && d.properties && selectedStates.has(d.properties.NAME)) ? '#dcdcdc' : '#1b1b1b');
  }

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

  // initial monthly averages from full fireData (mutable)
  let monthlyAvg = computeMonthlyAvg(fireData.features);

  // scales
  const x = d3.scalePoint().domain(d3.range(0,12)).range([0, chartWidth]).padding(0.5);
  const y = d3.scaleLinear().domain([d3.min(monthlyAvg.filter(d=>d!=null)) || 300, d3.max(monthlyAvg.filter(d=>d!=null)) || 340]).nice().range([chartHeight, 0]);

  // axes
  const xAxis = d3.axisBottom(x).tickFormat(i => (i+1)); // months 1..12
  const yAxis = d3.axisLeft(y).ticks(3);

  // add title
  chartSvg.append('text')
    .attr('class', 'chart-title')
    .attr('x', +chartSvg.attr('width') - 12)
    .attr('y', 10)
    .attr('text-anchor', 'end')
    .text('Avg Brightness by Month given Min Brightness Filter');

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
    .defined(d => d != null)
    .x((d,i) => x(i))
    .y(d => y(d));

  // empty line path and placeholder points — we'll update them from filtered data
  const linePath = chartG.append('path').attr('class','chart-line');
  chartG.selectAll('.chart-point').data(monthlyAvg).enter()
    .append('circle')
    .attr('class','chart-point')
    .attr('r', 3);

  // function to update chart based on a list of fire features
  function updateChartFromFires(fireFeatures) {
    monthlyAvg = computeMonthlyAvg(fireFeatures);
    // update y-domain
    const minVal = d3.min(monthlyAvg.filter(d=>d!=null)) || 300;
    const maxVal = d3.max(monthlyAvg.filter(d=>d!=null)) || 340;
    y.domain([minVal, maxVal]).nice();
    // redraw y axis
    chartG.select('.chart-axis.y-axis').call(d3.axisLeft(y).ticks(3));
    // update line
    linePath.datum(monthlyAvg).attr('d', line);
    // update points
    const pts = chartG.selectAll('.chart-point').data(monthlyAvg);
    pts.join(
      enter => enter.append('circle').attr('class','chart-point').attr('r',3),
      update => update,
      exit => exit.remove()
    ).attr('cx', (d,i) => x(i)).attr('cy', d => d!=null ? y(d) : -10);
    // recolor month rects using the new monthlyAvg
    chartG.selectAll('.month-rect').each(function(d,i) {
      const rect = d3.select(this);
      const avg = monthlyAvg[i];
      if (avg != null && typeof colorScale === 'function') {
        rect.style('fill', colorScale(avg)).style('opacity', 0.16);
      }
    });
  }

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
    // compute coordinates (GeoJSON is [lon, lat]) and format as decimal degrees
    let coordLine = '';
    if (d && d.geometry && Array.isArray(d.geometry.coordinates)) {
      const lon = +d.geometry.coordinates[0];
      const lat = +d.geometry.coordinates[1];
      if (!isNaN(lat) && !isNaN(lon)) {
        coordLine = `<div class="line"><span class="label">Lat:</span>${lat.toFixed(4)}° <span class="label" style="margin-left:8px">Lon:</span>${lon.toFixed(4)}°</div>`;
      }
    }

    tooltipEl.innerHTML = `
      <div class="line"><span class="label">Brightness:</span><strong>${typeof brightness === 'number' ? brightness.toFixed(2) : brightness}</strong></div>
      <div class="line"><span class="label">Date:</span>${dateStr}</div>
      <div class="line"><span class="label">Detected:</span>${daynight}</div>
      ${coordLine}
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
      if (!inSelectedSeason || d.properties.BRIGHTNESS < minBrightness) return false;
      // if any states are selected, only include fires within those state boundaries
      if (selectedStates.size > 0) {
        // check containment against the selected state features
        const sel = states.features.filter(s => selectedStates.has(s.properties && s.properties.NAME));
        // get a point coordinate [lon, lat] from the fire feature
        const pt = d && d.geometry && d.geometry.coordinates ? d.geometry.coordinates : null;
        if (!pt) return false;
        for (let i = 0; i < sel.length; i++) {
          try {
            // use the coordinate array (lon,lat) when testing containment
            if (d3.geoContains(sel[i], pt)) return true;
          } catch (e) {
            // ignore geometry errors and continue
          }
        }
        return false;
      }
      return true;
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

  // update chart to reflect current min-brightness (ignore season filtering for the line)
  const firesForChart = filteredFireData.filter(d => d.properties.BRIGHTNESS >= minBrightness);
  if (typeof updateChartFromFires === 'function') updateChartFromFires(firesForChart);
    if (typeof updateChartHighlights === 'function') updateChartHighlights(selectedSeasons);
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
