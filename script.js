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

// Write-up button opens new tab
const writeupBtn = document.getElementById("writeupBtn");
if (writeupBtn) {
  writeupBtn.addEventListener("click", () => {
    window.open("write-up.html", "_blank");
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
  // top-level map group so we can apply transforms (zoom/pan) to everything
  const gMap = svg.append('g').attr('class', 'map-layer');

  // --- DRAW GRATITCULE (longitude/latitude grid) ---
  // draw a subtle graticule behind the states and points. Step can be adjusted to 5 or 10 degrees.
  const graticule = d3.geoGraticule().step([10, 10]); // [lonStep, latStep] in degrees
  gMap.append('g')
    .attr('class', 'graticule-group')
    .append('path')
    .datum(graticule())
    .attr('class', 'graticule')
    .attr('d', path);

  // Add graticule tick labels (lon across top/bottom, lat at left/right)
  // We'll compute tick positions by projecting representative points and place labels at the SVG edges.
  const gLabels = gMap.append('g').attr('class', 'graticule-labels');
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

  const inset = gMap.append('g').attr('class', `inset-${stateName.replace(/\s+/g,'-').toLowerCase()}`);
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

  // move inset drawing to gMap by referencing the helper which uses gMap
  addInsetBox('Alaska', 'clip-ak', 10);
  addInsetBox('Hawaii', 'clip-hi', 10);

  // --- PRECOMPUTE FIRE -> STATE MAPPING (one-time, optimized) ---
  // Show a loading message while we compute the spatial index. The precompute
  // runs asynchronously (setTimeout) so the browser can render the message
  // before doing the heavy work.
  const loadingEl = d3.select('body').append('div')
    .attr('id', 'map-loading')
    .text('Loading map...')
    .style('position', 'fixed')
    .style('left', '50%')
    .style('top', '12px')
    .style('transform', 'translateX(-50%)')
    .style('background', 'rgba(0,0,0,0.75)')
    .style('color', '#fff')
    .style('padding', '8px 12px')
    .style('border-radius', '8px')
    .style('z-index', 9999)
    .style('font-size', '13px');

  setTimeout(() => {
    try {
      // Build quick lon/lat bounding boxes for states and prefilter by bbox
      // before running the more expensive d3.geoContains.
      const stateBounds = states.features.map(s => {
        const b = d3.geoBounds(s); // [[minLon,minLat],[maxLon,maxLat]]
        return { feature: s, name: s.properties && s.properties.NAME, bounds: b };
      });

      const padDeg = 0.01; // small padding to include boundary cases
      fireData.features.forEach(f => {
        const pt = f && f.geometry && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : null;
        const names = [];
        if (pt) {
          const lon = +pt[0], lat = +pt[1];
          if (!isNaN(lon) && !isNaN(lat)) {
            for (let i = 0; i < stateBounds.length; i++) {
              const sb = stateBounds[i];
              const minLon = sb.bounds[0][0] - padDeg;
              const minLat = sb.bounds[0][1] - padDeg;
              const maxLon = sb.bounds[1][0] + padDeg;
              const maxLat = sb.bounds[1][1] + padDeg;
              // cheap bbox check first
              if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
              try {
                if (d3.geoContains(sb.feature, pt)) {
                  if (sb.name) names.push(sb.name);
                }
              } catch (e) {
                // ignore errors for problematic geometries
              }
            }
          }
        }
        if (!f.properties) f.properties = {};
        f.properties._containingStates = names;
        f.properties._containingState = names.length === 0 ? null : (names.length === 1 ? names[0] : names.join(', '));
      });
    } finally {
      // remove loading indicator once precompute is done
      loadingEl.remove();
    }
  }, 20);

  // state selection set (names)
  const selectedStates = new Set();

  // create a bottom-left control container for reset and zoom buttons
  const controls = d3.select('body').append('div')
    .attr('id', 'selection-controls')
    .style('position', 'fixed')
    .style('left', '12px')
    .style('bottom', '12px')
    .style('display', 'flex')
    .style('gap', '8px')
    .style('align-items', 'center')
    .style('z-index', 9999);

  const resetBtn = controls.append('button')
    .attr('id', 'resetSelectionBtn')
    .text('Reset selection')
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
      // reset map transform to original view
      gMap.transition().duration(600).attr('transform', null);
      resetBtn.style('display', 'none');
      zoomInBtn.style('display', 'none');
      zoomOutBtn.style('display', 'none');
    });

  // zoom buttons (hidden until selection made)
  const zoomInBtn = controls.append('button')
    .attr('id', 'zoomInBtn')
    .text('Zoom In')
    .attr('title', 'Zoom to selected state(s)')
    .style('padding', '8px 10px')
    .style('background', 'rgba(0,0,0,0.6)')
    .style('color', '#fff')
    .style('border', '1px solid rgba(255,255,255,0.08)')
    .style('border-radius', '6px')
    .style('box-shadow', '0 6px 18px rgba(0,0,0,0.4)')
    .style('display', 'none');

  const zoomOutBtn = controls.append('button')
    .attr('id', 'zoomOutBtn')
    .text('Zoom Out')
    .attr('title', 'Reset zoom')
    .style('padding', '8px 10px')
    .style('background', 'rgba(0,0,0,0.6)')
    .style('color', '#fff')
    .style('border', '1px solid rgba(255,255,255,0.08)')
    .style('border-radius', '6px')
    .style('box-shadow', '0 6px 18px rgba(0,0,0,0.4)')
    .style('display', 'none');

  // zoom handlers will be attached below after statesG exists


  // --- DRAW STATES ---
  // create a dedicated group for state paths so we don't accidentally bind to
  // other <path> elements (graticules, inset paths, etc.) that were appended earlier
  const statesG = gMap.append('g').attr('class', 'states-group');
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
      // show/hide reset and zoom buttons
      if (selectedStates.size > 0) {
        resetBtn.style('display', 'block');
        zoomInBtn.style('display', 'inline-block');
        zoomOutBtn.style('display', 'none');
      } else {
        resetBtn.style('display', 'none');
        zoomInBtn.style('display', 'none');
        zoomOutBtn.style('display', 'none');
      }
      // update points shown
      updateFires();
    });

  function updateStateStyles() {
    statesG.selectAll('path').attr('fill', d => (d && d.properties && selectedStates.has(d.properties.NAME)) ? '#dcdcdc' : '#1b1b1b');
  }

  // compute a transform (translate, scale) that fits the union of selected states
  function computeFitTransform() {
    if (selectedStates.size === 0) return null;
    // union bounds in projected pixel space
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    states.features.forEach(f => {
      const name = f.properties && f.properties.NAME;
      if (!name || !selectedStates.has(name)) return;
      try {
        const b = path.bounds(f); // [[x0,y0],[x1,y1]]
        if (b && b[0] && b[1]) {
          x0 = Math.min(x0, b[0][0]);
          y0 = Math.min(y0, b[0][1]);
          x1 = Math.max(x1, b[1][0]);
          y1 = Math.max(y1, b[1][1]);
        }
      } catch (e) {
        // ignore
      }
    });
    if (!isFinite(x0) || !isFinite(y0) || !isFinite(x1) || !isFinite(y1)) return null;
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx <= 0 || dy <= 0) return null;
    const padding = 40; // px padding around selection
    const k = Math.min((width - padding) / dx, (height - padding) / dy) * 0.95;
    // center of bounding box
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const tx = (width / 2) - k * cx;
    const ty = (height / 2) - k * cy;
    return { k, tx, ty };
  }

  // wire zoom buttons
  zoomInBtn.on('click', () => {
    const t = computeFitTransform();
    if (!t) return;
    gMap.transition().duration(700).attr('transform', `translate(${t.tx},${t.ty}) scale(${t.k})`);
    zoomOutBtn.style('display', 'inline-block');
  });

  zoomOutBtn.on('click', () => {
    gMap.transition().duration(700).attr('transform', null);
    zoomOutBtn.style('display', 'none');
  });

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
  const brightnessScale = d3.scaleLinear().domain([325, 510]).range([1, 6]);
  const colorScale = d3.scaleSequential(d3.interpolateRgb("red", "yellow")).domain([325, 510]);
  // opacity scale: lower brightness -> more transparent, higher brightness -> more opaque
  const opacityScale = d3.scaleLinear().domain([325, 510]).range([0.35, 0.9]);
  // --- ADD FIRES ---
  const pointsGroup = gMap.append("g");

  // --- BRIGHTNESS BY MONTH CHART ---
  const chartSvg = d3.select('#chartSvg');
  // add a larger bottom margin so axis ticks and labels are not clipped
  const chartMargin = {top: 18, right: 12, bottom: 48, left: 36};
  // compute chart drawing area from rendered SVG size (client size) so the
  // chart adapts to CSS/container sizing and doesn't overflow the viewport.
  function getChartSize() {
    const rect = chartSvg.node().getBoundingClientRect();
    const w = rect.width - chartMargin.left - chartMargin.right;
    const h = rect.height - chartMargin.top - chartMargin.bottom;
    return { width: Math.max(10, w), height: Math.max(10, h) };
  }
  let { width: chartWidth, height: chartHeight } = getChartSize();
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
  // cache last dataset used for the small chart so we can re-render on resize
  let lastFiresForChart = filteredFireData.slice();

  // scales (use let so we can update ranges if the container size changes)
  let x = d3.scalePoint().domain(d3.range(0,12)).range([0, chartWidth]).padding(0.5);
  let y = d3.scaleLinear().domain([d3.min(monthlyAvg.filter(d=>d!=null)) || 300, d3.max(monthlyAvg.filter(d=>d!=null)) || 340]).nice().range([chartHeight, 0]);

  // axes
  const xAxis = d3.axisBottom(x).tickFormat(i => (i+1)); // months 1..12
  const yAxis = d3.axisLeft(y).ticks(3);

  // chart title is rendered as an HTML element placed above the svg (see index.html)

  // draw axes (keep references so we can update them when sizes change)
  const xAxisG = chartG.append('g').attr('class','chart-axis x-axis').attr('transform', `translate(0,${chartHeight})`);
  const yAxisG = chartG.append('g').attr('class','chart-axis y-axis');
  xAxisG.call(xAxis);
  yAxisG.call(yAxis);

  // x-axis label: position using bottom margin so it stays visible
  const xLabel = chartG.append('text')
    .attr('class','axis-label')
    .attr('x', chartWidth / 2)
    .attr('y', chartHeight + chartMargin.bottom - 10)
    .attr('text-anchor','middle')
    .text('month');

  // y-axis label (keep a reference so we can reposition if size changes)
  const yLabel = chartG.append('text')
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
    // recompute sizes in case the chart container changed (CSS or viewport)
    const size = getChartSize();
    chartWidth = size.width;
    chartHeight = size.height;
    // update scales ranges
    x.range([0, chartWidth]);
    y.range([chartHeight, 0]);

    monthlyAvg = computeMonthlyAvg(fireFeatures);
    // update y-domain
    const minVal = d3.min(monthlyAvg.filter(d=>d!=null)) || 300;
    const maxVal = d3.max(monthlyAvg.filter(d=>d!=null)) || 340;
    y.domain([minVal, maxVal]).nice();
    // redraw y axis
    yAxisG.call(d3.axisLeft(y).ticks(3));
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
      // update rect geometry in case size changed
      rect.attr('x', x(i) - (chartWidth/12)/2 ).attr('width', (chartWidth/12)).attr('height', chartHeight);
      const avg = monthlyAvg[i];
      if (avg != null && typeof colorScale === 'function') {
        rect.style('fill', colorScale(avg)).style('opacity', 0.16);
      }
    });
    // update x axis positioning and label using new chartHeight
    xAxisG.attr('transform', `translate(0,${chartHeight})`).call(xAxis);
    xLabel.attr('x', chartWidth / 2).attr('y', chartHeight + chartMargin.bottom - 10);
    // update y-label position as well
    yLabel.attr('transform', `translate(-28,${chartHeight/2}) rotate(-90)`);
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

    // state info from precomputed mapping
    const stateInfo = (props && props._containingState) ? props._containingState : 'Unknown';

    tooltipEl.innerHTML = `
      <div class="line"><span class="label">Brightness:</span><strong>${typeof brightness === 'number' ? brightness.toFixed(2) : brightness}</strong></div>
      <div class="line"><span class="label">Date:</span>${dateStr}</div>
      <div class="line"><span class="label">Detected:</span>${daynight}</div>
      <div class="line"><span class="label">State:</span>${stateInfo}</div>
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

  // --- TITLE & SUBTITLES UPDATING ---
  const titleEl = document.getElementById('mainTitle');
  const timeSubtitleEl = document.getElementById('timeSubtitle');
  const statesSubtitleEl = document.getElementById('statesSubtitle');

  const allYears = fireData.features.map(d => new Date(d.properties.ACQ_DATE).getFullYear()).filter(y => !isNaN(y));
  const latestYear = allYears.length ? Math.max(...allYears) : (new Date()).getFullYear();
  const orderedMonths = [10,11,0,1,2,3,4,5,6,7,8,9]; // Nov -> Oct ordering
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  // Compute dataset start/end safely (ignore invalid ACQ_DATE values)
  const validDates = fireData.features.map(d => {
    try { return d && d.properties && d.properties.ACQ_DATE ? new Date(d.properties.ACQ_DATE) : null; } catch (e) { return null; }
  }).filter(d => d instanceof Date && !isNaN(d));
  const datasetStart = validDates.length ? new Date(Math.min(...validDates.map(d => d.getTime()))) : null;
  const datasetEnd = validDates.length ? new Date(Math.max(...validDates.map(d => d.getTime()))) : null;

  // Helper: find the year for a given month within the dataset range.
  // If preferStart is true, find the first occurrence of that month on/after datasetStart;
  // otherwise find the last occurrence on/before datasetEnd. If dataset bounds
  // are unavailable, fall back to the latestYear heuristic.
  function yearForMonthNearest(month, preferStart) {
    if (datasetStart instanceof Date && datasetEnd instanceof Date) {
      if (preferStart) {
        const cur = new Date(datasetStart.getFullYear(), datasetStart.getMonth(), 1);
        const end = new Date(datasetEnd.getFullYear(), datasetEnd.getMonth(), 1);
        while (cur.getTime() <= end.getTime()) {
          if (cur.getMonth() === month) return cur.getFullYear();
          cur.setMonth(cur.getMonth() + 1);
        }
      } else {
        const cur = new Date(datasetEnd.getFullYear(), datasetEnd.getMonth(), 1);
        const start = new Date(datasetStart.getFullYear(), datasetStart.getMonth(), 1);
        while (cur.getTime() >= start.getTime()) {
          if (cur.getMonth() === month) return cur.getFullYear();
          cur.setMonth(cur.getMonth() - 1);
        }
      }
    }
    return month >= 10 ? latestYear - 1 : latestYear;
  }

  // Title is now static; no dynamic brightness number to update.

  // Build a per-season range string like: "Winter (Nov 2024–Jan 2025)"
  function seasonRangeString(seasonName) {
    const months = seasons[seasonName];
    if (!months || months.length === 0) return seasonName;
    const startMonth = months[0];
    const endMonth = months[months.length - 1];
    const startYear = startMonth >= 10 ? latestYear - 1 : latestYear;
    const endYear = endMonth >= 10 ? latestYear - 1 : latestYear;
    const startName = monthNames[startMonth];
    const endName = monthNames[endMonth];
    return `${seasonName} (${startName} ${startYear}–${endName} ${endYear})`;
  }

  // Update time subtitle by merging consecutive months into continuous ranges.
  // If selected months form consecutive spans (in the Nov->Oct ordering) they
  // are shown as a single "startMonth startYear–endMonth endYear" chunk. Non-
  // contiguous spans are separated by commas.
  function updateTimeSubtitle(selectedSeasons) {
    if (!timeSubtitleEl) return;
    if (!selectedSeasons || selectedSeasons.length === 0) {
      timeSubtitleEl.textContent = 'Time Frame Currently Displaying: none';
      return;
    }
    // build a set of months (0-11) included by the selected seasons
    const monthsSet = new Set();
    selectedSeasons.forEach(s => { if (seasons[s]) seasons[s].forEach(m => monthsSet.add(m)); });
    if (monthsSet.size === 0) {
      timeSubtitleEl.textContent = 'Time Frame Currently Displaying: none';
      return;
    }
    // Prefer grouping by actual chronological months within the dataset span.
    // Build a timeline of month-year slots between the dataset min and max.
    const validDates = fireData.features.map(d => {
      try { return d && d.properties && d.properties.ACQ_DATE ? new Date(d.properties.ACQ_DATE) : null; } catch (e) { return null; }
    }).filter(d => d instanceof Date && !isNaN(d));
    const datasetStart = validDates.length ? new Date(Math.min(...validDates.map(d => d.getTime()))) : null;
    let datasetEnd = validDates.length ? new Date(Math.max(...validDates.map(d => d.getTime()))) : null;
    // If dataset was intentionally truncated to end at October, clamp the
    // datasetEnd month to October (month 9) to avoid showing November ranges.
    if (datasetEnd instanceof Date && !isNaN(datasetEnd) && datasetEnd.getMonth() > 9) {
      datasetEnd = new Date(datasetEnd.getFullYear(), 9, 1); // October of that year
    }

    if (datasetStart && datasetEnd) {
      // build chronological month list from datasetStart..datasetEnd inclusive
      const timeline = [];
      const cur = new Date(datasetStart.getFullYear(), datasetStart.getMonth(), 1);
      const end = new Date(datasetEnd.getFullYear(), datasetEnd.getMonth(), 1);
      while (cur.getTime() <= end.getTime()) {
        timeline.push({ year: cur.getFullYear(), month: cur.getMonth() });
        cur.setMonth(cur.getMonth() + 1);
      }

      // mark which timeline entries are selected (by month number)
      const marked = timeline.map(t => monthsSet.has(t.month) ? 1 : 0);

      // find contiguous runs in timeline
      const runs = [];
      let runStart = null;
      for (let i = 0; i < marked.length; i++) {
        if (marked[i] && runStart === null) runStart = i;
        if ((!marked[i] || i === marked.length - 1) && runStart !== null) {
          const runEnd = marked[i] ? i : i - 1;
          runs.push({ start: runStart, end: runEnd });
          runStart = null;
        }
      }

      const parts = runs.map(r => {
        const s = timeline[r.start];
        const e = timeline[r.end];
        const startName = monthNames[s.month];
        const endName = monthNames[e.month];
        return `${startName} ${s.year}–${endName} ${e.year}`;
      });

      timeSubtitleEl.textContent = `Time Frame Currently Displaying: ${parts.join(', ')}`;
      return;
    }

    // fallback to previous month-order heuristic if dataset bounds unavailable
    const marked = orderedMonths.map(m => monthsSet.has(m) ? 1 : 0);
    const runsFallback = [];
    let runStartFb = null;
    for (let i = 0; i < marked.length; i++) {
      if (marked[i] && runStartFb === null) runStartFb = i;
      if ((!marked[i] || i === marked.length - 1) && runStartFb !== null) {
        const runEnd = marked[i] ? i : i - 1;
        runsFallback.push({ start: runStartFb, end: runEnd });
        runStartFb = null;
      }
    }
    if (runsFallback.length >= 2 && runsFallback[0].start === 0 && runsFallback[runsFallback.length - 1].end === marked.length - 1) {
      const first = runsFallback.shift();
      const last = runsFallback.pop();
      runsFallback.unshift({ start: last.start, end: first.end });
    }
    const partsFb = runsFallback.map(r => {
      const startMonth = orderedMonths[r.start];
      const endMonth = orderedMonths[r.end];
      const startYear = startMonth >= 10 ? latestYear - 1 : latestYear;
      const endYear = endMonth >= 10 ? latestYear - 1 : latestYear;
      return `${monthNames[startMonth]} ${startYear}–${monthNames[endMonth]} ${endYear}`;
    });
    timeSubtitleEl.textContent = `Time Frame Currently Displaying: ${partsFb.join(', ')}`;
  }

  // Update states subtitle based on selectedStates set
  function updateStatesSubtitle() {
    if (!statesSubtitleEl) return;
    if (!selectedStates || selectedStates.size === 0) {
      statesSubtitleEl.textContent = 'States: all states';
      return;
    }
    const arr = Array.from(selectedStates).sort();
    statesSubtitleEl.textContent = `States: ${arr.join(', ')}`;
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
    const minBrightness = +document.getElementById("brightnessSlider").value;
  // update subtitles to reflect current filters
  try { updateTimeSubtitle(selectedSeasons); } catch (e) {}
  try { updateStatesSubtitle(); } catch (e) {}

    const firesToShow = filteredFireData.filter(d => {
      const month = new Date(d.properties.ACQ_DATE).getMonth();
      const inSelectedSeason = selectedSeasons.some(s => seasons[s].includes(month));
      if (!inSelectedSeason || d.properties.BRIGHTNESS < minBrightness) return false;
      // if any states are selected, only include fires within those state boundaries
      if (selectedStates.size > 0) {
        // use precomputed containing states on the fire feature for a fast check
        const c = (d.properties && d.properties._containingStates) ? d.properties._containingStates : [];
        if (!c || c.length === 0) return false;
        // return true if any of the containing state names are in selectedStates
        for (let i = 0; i < c.length; i++) if (selectedStates.has(c[i])) return true;
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
      .attr("opacity", d => opacityScale(d.properties.BRIGHTNESS))
      .on('mouseover', (event, d) => showTooltip(event, d))
      .on('mousemove', (event, d) => moveTooltip(event, d))
      .on('mouseout', () => hideTooltip())
      .transition()
      .duration(150)
      .attr("r", d => brightnessScale(d.properties.BRIGHTNESS));

    // UPDATE
    points.transition()
      .duration(150)
      .attr("cx", d => projection(d.geometry.coordinates)[0])
      .attr("cy", d => projection(d.geometry.coordinates)[1])
      .attr("r", d => brightnessScale(d.properties.BRIGHTNESS))
      .attr("fill", d => colorScale(d.properties.BRIGHTNESS))
      .attr("opacity", d => opacityScale(d.properties.BRIGHTNESS));
      

    // ensure existing circles also have tooltip handlers
    pointsGroup.selectAll('circle')
      .on('mouseover', (event, d) => showTooltip(event, d))
      .on('mousemove', (event, d) => moveTooltip(event, d))
      .on('mouseout', () => hideTooltip());

  // update chart to reflect current min-brightness (ignore season filtering for the line)
  // Chart should reflect min-brightness AND selected states (if any).
  // If no states are selected, use all fires that meet minBrightness. If states
  // are selected, restrict to fires whose precomputed _containingStates include
  // any selected state.
  const firesForChart = filteredFireData.filter(d => {
    if (!d || !d.properties) return false;
    if (d.properties.BRIGHTNESS < minBrightness) return false;
    if (selectedStates.size === 0) return true;
    const c = d.properties._containingStates || [];
    for (let i = 0; i < c.length; i++) if (selectedStates.has(c[i])) return true;
    return false;
  });
  if (typeof updateChartFromFires === 'function') {
    lastFiresForChart = firesForChart;
    updateChartFromFires(firesForChart);
  }
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

  // re-render chart on window resize so axis/ticks/labels remain visible
  window.addEventListener('resize', () => {
    try {
      if (typeof updateChartFromFires === 'function') updateChartFromFires(lastFiresForChart);
    } catch (e) {
      // ignore transient errors during resize
    }
  });

  updateFires(); // initial render
});
