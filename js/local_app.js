// VERSION COUNTER - UPDATE THIS WITH EACH COMMIT FOR VISIBILITY
window.SVR_PWA_VERSION = "0.2.1"; // Increment this number with each commit

(function () {
    // Typewriter effect for splash screen (now using CSS class)
    function typewriterEffect(elementId, text) {
        const targetElement = document.getElementById(elementId);
        if (!targetElement) return;

        targetElement.textContent = text;
        targetElement.classList.remove('typewriter');
        void targetElement.offsetWidth; // Force reflow to restart animation
        targetElement.classList.add('typewriter');
    }
    window.typewriterEffect = typewriterEffect; // Expose globally

    if (window.SVR_FILTER_OVERLAY_INJECTED) return;
    window.SVR_FILTER_OVERLAY_INJECTED = true;

    // Flag to track if we already have some data on screen
    window.hasDataOnScreen = false;

    // Introduce a flag to control PWA prompt visibility after help overlay interaction
    window.shouldShowPWAAfterHelp = false; // Initialize the flag

    // --- DEBUG LOGGING ---
    function logDebug(msg) {
        console.log(`[v${window.SVR_PWA_VERSION}] ${msg}`);
        // Removed on-screen debug console as requested
    }
    window.logDebug = logDebug;
    logDebug("SVR PWA v2.5 Start");

    // --- INSTANT CACHE / PRESET LOGIC ---
    window.loadCachedCampsites = async function() {
        performance.mark('instant-map-start');
        try {
            // Plaats de rode punaise direct op de startlocatie (Nederland)
            const startLat = 52.1326, startLng = 5.2913;
            if (centerMarker) map.removeLayer(centerMarker);
            centerMarker = L.marker([startLat, startLng], { 
                icon: L.divIcon({ 
                    className: 'search-marker', 
                    html: '<i class="fa-solid fa-map-pin" style="color:#c0392b;font-size:30px;"></i>', 
                    iconSize:[30,30], 
                    iconAnchor:[15,30] 
                }),
                zIndexOffset: 2000 
            }).addTo(map);

            let data = null;
            const cached = localStorage.getItem('svr_cache_campsites');
            
            if (cached) {
                logDebug("Laden van campings uit LocalStorage cache...");
                data = { objects: JSON.parse(cached) };
            } else {
                logDebug("Laden van campings uit assets/campsites_preset.json...");
                const res = await fetch('assets/campsites_preset.json');
                if (res.ok) data = await res.json();

                // NEW: If loaded from preset, save to localStorage for subsequent searches
                if (data && data.objects && data.objects.length > 0) {
                    try {
                        // Strip data before saving to localStorage to keep it light
                        const strippedObjects = data.objects.map(o => ({
                            id: o.id,
                            geometry: o.geometry,
                            properties: {
                                name: o.properties.name,
                                city: o.properties.city,
                                type_camping: o.properties.type_camping,
                                facilities: o.properties.facilities,
                                address: o.properties.address
                            }
                        }));
                        localStorage.setItem('svr_cache_campsites', JSON.stringify(strippedObjects));
                        logDebug(`Preset geladen en opgeslagen in LocalStorage (${strippedObjects.length} items).`);
                    } catch(e) { logDebug("Preset Cache Opslag Fout: " + e.message); }
                }
            }

            if (data && data.objects && data.objects.length > 0) {
                const sLat = 52.1326, sLng = 5.2913;
                data.objects.forEach(o => { 
                    o.distM = o.geometry ? calculateDistance(sLat, sLng, o.geometry.coordinates[1], o.geometry.coordinates[0]) : 999999; 
                });
                data.objects.sort((a, b) => a.distM - b.distM);
                
                // Direct renderen (gebruik skipFitBounds om verspringen te voorkomen)
                window.skipFitBounds = true;
                renderResults(data.objects, sLat, sLng);
                window.skipFitBounds = false;
                
                window.hasDataOnScreen = true;
                logDebug(`Direct geladen: ${data.objects.length} campings.`);
            }
        } catch (e) {
            logDebug("Cache/Preset Fout: " + e.message);
        } finally {
            performance.mark('instant-map-end');
            performance.measure('Instant Map Loading', 'instant-map-start', 'instant-map-end');
        }
    };

    // --- CSV & SEARCH LOGIC ---
    window.allLocations = [];
    async function loadLocations() {
        try {
            const res = await fetch('assets/Woonplaatsen_in_Nederland.csv');
            const text = await res.text();
            const lines = text.split('\n');
            window.allLocations = lines.slice(1).map(line => {
                const parts = line.split(';');
                if (parts.length >= 2) return { name: parts[0].trim(), province: parts[1].trim() };
                return null;
            }).filter(l => l && l.name);
            logDebug("CSV OK: " + window.allLocations.length);
        } catch (e) { logDebug("CSV Fout: " + e.message); }
    }
    loadLocations();

    window.getSuggestionsLocal = function(q) {
        const queryLower = q.toLowerCase().trim();
        return window.allLocations.filter(l => 
            l.name.toLowerCase().startsWith(queryLower) || 
            l.name.toLowerCase().includes(" " + queryLower)
        ).slice(0, 10).map(l => `${l.name} (${l.province})`);
    };

    window.getCoordinatesWeb = async function(place) {
        const locationName = place.includes(" (") ? place.split(" (")[0] : place;
        try {
            // If the place name is not in our local Dutch list and doesn't already have a country suffix, 
            // search globally. Otherwise, prefer Netherlands for common names.
            let query = locationName;
            const isLocal = window.allLocations.some(l => l.name.toLowerCase() === locationName.toLowerCase());
            if (isLocal && !locationName.includes(",")) {
                query += ", Nederland";
            }

            const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
            logDebug(`Fetching coordinates for "${query}" via Worker proxy.`);
            const contents = await fetchWithRetry(nominatimUrl); // Use fetchWithRetry
            const data = JSON.parse(contents);
            if (data && data.length > 0) {
                return { latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon) };
            }
        } catch (e) { logDebug("Geocode Fout: " + e.message); }
        return null;
    };

    window.proxyUrl = function(url, provider = 'ao') {
        if (provider === 'ao') return "https://api.allorigins.win/get?url=" + encodeURIComponent(url);
        return "https://corsproxy.io/?" + encodeURIComponent(url);
    }

    async function fetchWithRetry(url) {
        logDebug("Fetch via Cloudflare Worker Proxy...");
        // Replace with your deployed Cloudflare Worker URL
        const PROXY_BASE_URL = 'https://svr-proxy-worker.e60-manuels.workers.dev'; 
    
        const originalUrl = new URL(url); // Parse original URL once
        let fetchUrl = url;
        const options = { headers: {}, credentials: 'include' }; // Initialize options with credentials: 'include'

        // Determine if we need to add X-SVR-Session.
        // This is needed if the request is for www.svr.nl (to be proxied through worker)
        // OR if the request is already directly to the PROXY_BASE_URL (meaning it's
        // already going to the worker, and the worker needs the session).
        const needsSVRSession = originalUrl.hostname === 'www.svr.nl' || originalUrl.hostname === new URL(PROXY_BASE_URL).hostname;

        // If the URL is originally for svr.nl or nominatim, construct the worker-proxied URL
        if (originalUrl.hostname === 'www.svr.nl' || originalUrl.hostname === 'nominatim.openstreetmap.org') {
            // Construct the URL to hit our proxy's forwarding endpoint
            let pathForProxy = originalUrl.pathname;

            // For Nominatim, use the full path and hostname directly
            if (originalUrl.hostname === 'nominatim.openstreetmap.org') {
                pathForProxy = originalUrl.hostname + originalUrl.pathname;
            }

            fetchUrl = `${PROXY_BASE_URL}/${pathForProxy}${originalUrl.search}`;
            logDebug(`Proxying original request: ${url} -> ${fetchUrl}`);
        } else {
            // If the URL is ALREADY the proxy base URL, then we treat it as a direct proxy request
            if (originalUrl.hostname === new URL(PROXY_BASE_URL).hostname) {
                logDebug(`Direct request to Worker: ${url}`);
                // No need to re-construct fetchUrl, it's already the target.
            } else {
                logDebug(`Fetching non-proxied request directly: ${url}`);
            }
        }

        // Manually add session ID and Filters from state/localStorage only for SVR requests
        if (needsSVRSession) {
            // 1. Session
            const sessionId = localStorage.getItem('svr_session_id');
            if (sessionId) {
                options.headers['X-SVR-Session'] = sessionId;
                logDebug(`Adding X-SVR-Session header: ${sessionId.substring(0, 20)}...`);
            } else {
                logDebug('No session ID found in localStorage for SVR request.');
            }

            // 2. Filters & Config (Headers instead of Cookies)
            if (window.currentFilters && window.currentFilters.length > 0) {
                const filtersJson = JSON.stringify(window.currentFilters);
                const configJson = JSON.stringify({
                    filters: window.currentFilters,
                    geo: {},
                    search_free: {},
                    favorite: "0"
                });
                
                options.headers['X-SVR-Filters'] = filtersJson;
                options.headers['X-SVR-Config'] = configJson;
                logDebug(`Adding Filter headers. Count: ${window.currentFilters.length}`);
            }
        }

        // options.credentials = 'include'; // Removed, as we manually manage session via custom header

        try {
            const res = await fetch(fetchUrl, options);

            // Check for 401 = sessie expired (only for SVR requests)
            if (originalUrl.hostname === 'www.svr.nl' && res.status === 401) { // Fixed: used originalUrl.hostname
                console.warn('⚠️ Sessie verlopen, opnieuw inloggen vereist');
                logDebug('⚠️ Sessie verlopen (401)');
                if (window.showLoginScreen) window.showLoginScreen();
                throw new Error('Session expired');
            }

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`HTTP error! Status: ${res.status}, Response: ${errorText}`);
            }

            // Handle Set-Cookie headers from the response
            // This is important for filters and other server-side state
            const setCookieHeaders = res.headers.get('Set-Cookie');
            if (setCookieHeaders && originalUrl.hostname === 'www.svr.nl') {
                // In a real browser, these would be automatically stored and sent with future requests
                // For our PWA, we need to handle them manually
                logDebug(`Received Set-Cookie headers: ${setCookieHeaders.substring(0, 100)}...`);
            }

            return await res.text();
        } catch (e) {
            logDebug("Fetch via Proxy mislukt: " + e.message);
            if (e.message === 'Session expired') throw e;
            return "";
        }
    }    window.fetchWithRetry = fetchWithRetry;

    window.openNavHelper = function(lat, lng, nameEnc) {
        try {
            const name = decodeURIComponent(escape(window.atob(nameEnc)));
            const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
            window.open(url, '_blank');
        } catch(e) { logDebug("Nav Fout: " + e.message); }
    };

    const css = `
        #svr-filter-backdrop { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9990; display: none; opacity: 0; transition: opacity 0.3s ease; }
        #svr-filter-backdrop.open { display: block; opacity: 1; }
        #svr-filter-overlay { 
            position: fixed; top: 88px; left: 0; width: 100%; height: calc(100% - 88px); 
            background-color: #f0f0f0; z-index: 9995; display: flex; flex-direction: column; 
            box-sizing: border-box; transform: translateY(100%); transition: transform 0.4s cubic-bezier(0.25, 0.1, 0.25, 1);
            border-top-left-radius: 12px; border-top-right-radius: 12px; box-shadow: 0 -2px 10px rgba(0,0,0,0.1);
        }
        #svr-filter-overlay.open { transform: translateY(0); }
        .svr-overlay-header { background-color: #f0f0f0; padding: 8px 15px 12px 15px; display: flex; flex-direction: column; align-items: flex-start; border-top-left-radius: 12px; border-top-right-radius: 12px; }
        .svr-overlay-title { font-size: 1.2rem; font-weight: bold; margin: 0; color: #008AD3; font-family: 'Befalow', sans-serif; text-align: left; padding-left: 15px; }
        #svr-filter-overlay-content { flex-grow: 1; overflow-y: auto; width: 100%; background-color: #f0f0f0; padding: 15px; box-sizing: border-box; scroll-behavior: smooth; }
        #active-filters-holder { background: #FDCC01; border-radius: 12px; padding: 12px 15px; margin-bottom: 15px; display: none; box-sizing: border-box; width: 100%; position: sticky; top: 0; z-index: 100; }
        .active-filter-tag { display: inline-flex; align-items: center; background: white; padding: 4px 10px; border-radius: 15px; margin: 4px; font-size: 12px; font-weight: bold; color: #008AD3; border: 1px solid #ddd; }
        .filter-section-card { background: white; border-radius: 12px; margin-bottom: 10px; overflow: hidden; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
        .filter-section-header { padding: 12px 15px; background: #FDCC01; display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
        .filter-section-header h4 { margin: 0; font-size: 22px; color: #333; font-family: 'Befalow', sans-serif; }
        .filter-section-body { padding: 0 15px; display: none; }
        .filter-section-body.show { display: block; padding-bottom: 10px; }
        .svr-overlay-footer { padding: 12px 15px; border-top: 1px solid #ddd; display: flex; gap: 15px; background: #f0f0f0; }
        .svr-footer-btn { flex: 1; height: 40px; border-radius: 20px; font-size: 0.9rem; font-weight: bold; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        #svr-filter-apply-btn { background-color: #FDCC01; color: #333; }
        #svr-filter-reset-btn { background-color: white; color: #c0392b; border: 1px solid #ddd; }
        .filter-item { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f9f9f9; }
    `;
    const style = document.createElement('style'); style.appendChild(document.createTextNode(css)); document.head.appendChild(style);

    const backdrop = document.createElement('div'); backdrop.id = 'svr-filter-backdrop'; document.body.appendChild(backdrop);
    const overlay = document.createElement('div'); overlay.id = 'svr-filter-overlay';
    overlay.innerHTML = `
        <div class="svr-overlay-header" id="filter-drag-header">
            <div style="width: 100%; display: flex; justify-content: center; margin-bottom: 10px; pointer-events: none;"><div style="width: 40px; height: 5px; background: #BBB; border-radius: 3px;"></div></div>
            <h3 class="svr-overlay-title">Filters</h3>
        </div>
        <div id="svr-filter-overlay-content">
            <div id="active-filters-holder"><div id="active-tags-container"></div></div>
            <div id="filter-loading" style="text-align:center; padding: 40px;"><i class="fas fa-spinner fa-spin fa-2x" style="color:#008AD3"></i><p>Filters ophalen...</p></div>
            <div id="filter-container"></div>
        </div>
        <div class="svr-overlay-footer">
            <button id="svr-filter-reset-btn" class="svr-footer-btn">Wis filters</button>
            <button id="svr-filter-apply-btn" class="svr-footer-btn">Toepassen</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const content = overlay.querySelector('#filter-container');
    const loading = overlay.querySelector('#filter-loading');

    // Generic Swipe-to-Close Logic
    window.enableSwipeToClose = function(element, closeCallback, dragHandleSelector) {
        let startY = 0;
        let currentY = 0;
        let isDragging = false;
        const dragHandle = element.querySelector(dragHandleSelector || '.svr-overlay-header, .detail-header');

        if (!dragHandle) return;

        dragHandle.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
            isDragging = true;
            element.style.transition = 'none'; // Disable transition for direct tracking
        }, {passive: true});

        dragHandle.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            currentY = e.touches[0].clientY;
            const deltaY = currentY - startY;

            if (deltaY > 0) { // Only allow dragging downwards
                e.preventDefault(); // Prevent scrolling
                element.style.transform = `translateY(${deltaY}px)`;
            }
        }, {passive: false});

        dragHandle.addEventListener('touchend', (e) => {
            if (!isDragging) return;
            isDragging = false;
            element.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.1, 0.25, 1)'; // Restore transition
            
            const deltaY = currentY - startY;
            const threshold = 100; // Pixel threshold to close

            if (deltaY > threshold) {
                element.style.transform = 'translateY(100%)'; // Visual close immediately
                setTimeout(() => {
                    closeCallback(); // Trigger full cleanup after animation start
                }, 10);
            } else {
                element.style.transform = 'translateY(0)'; // Snap back
            }
            startY = 0;
            currentY = 0;
        });
    };

    window.closeFilterOverlay = function() { 
        overlay.classList.remove('open'); 
        backdrop.classList.remove('open');
        
        // Also handle detail container if open
        const detailOverlay = document.getElementById('detail-container');
        if (detailOverlay && detailOverlay.classList.contains('open')) {
            window.handleDetailBack();
        }

        overlay.style.transform = ''; // Clear inline transform from swipe
        setTimeout(() => { 
            if (!overlay.classList.contains('open') && (!detailOverlay || !detailOverlay.classList.contains('open'))) {
                backdrop.style.display = 'none'; 
            }
        }, 500);
    };
    backdrop.onclick = window.closeFilterOverlay;

    // Enable swipe for filter overlay
    window.enableSwipeToClose(overlay, window.closeFilterOverlay, '.svr-overlay-header');

    window.toggle_filters = async function() {
        backdrop.style.display = 'block';
        overlay.style.transform = ''; // Reset any residual swipe transforms
        setTimeout(() => { overlay.classList.add('open'); backdrop.classList.add('open'); }, 10);
        if (content.children.length === 0 && !window.isFetchingFilters) await fetchFilterData();
    };

    window.isFetchingFilters = false;
    async function fetchFilterData() {
        if (window.isFetchingFilters) return;
        window.isFetchingFilters = true;
        try {
            logDebug("Filters ophalen...");
            const contents = await fetchWithRetry('https://www.svr.nl/objects');

            if (contents.includes("<!doctype") || contents.includes("<html")) {
                const doc = new DOMParser().parseFromString(contents, 'text/html');

                // Check if it's an error page by looking for common error indicators
                // Only consider it an error if it contains error indicators AND it's not the expected page
                const errorIndicators = ['login', 'inloggen', 'error', '404', 'not found', 'access denied', 'forbidden', 'sessie verlopen', 'session expired'];
                const lowerContents = contents.toLowerCase();
                const titleText = doc.title ? doc.title.toLowerCase() : '';

                // Consider it an error page only if it contains error indicators but NOT the expected page content
                const hasErrorIndicators = errorIndicators.some(indicator => lowerContents.includes(indicator));
                const hasExpectedContent = titleText.includes('camping') || lowerContents.includes('zoeker') || lowerContents.includes('filter');

                const isErrorPage = hasErrorIndicators && !hasExpectedContent;

                if (isErrorPage) {
                    logDebug("Foutpagina ontvangen: " + (doc.title || "Onbekende fout"));
                    loading.style.display = 'none';
                    content.innerHTML = '<div style="padding:20px;text-align:center;">Fout bij ophalen filters</div>';
                    window.isFetchingFilters = false;
                    return;
                }

                loading.style.display = 'none';
                content.innerHTML = '';


                // Zoek alle koppen met de klasse 'befalow' zoals in de originele Android app
                const befalowElements = Array.from(doc.querySelectorAll('.befalow')).filter(el => {
                    const txt = el.innerText.trim();
                    // We pakken alle koppen met tekst, behalve de hele korte
                    return txt.length > 2 && !txt.includes('Kamperen bij de boer');
                });

                befalowElements.forEach((headerEl) => {
                    const title = headerEl.innerText.trim().replace(/:$/, '');
                    // De header-container op de site is de div die de befalow bevat
                    const headerContainer = headerEl.closest('div.w-100') || headerEl.parentElement;

                    const sectionCard = document.createElement('div');
                    sectionCard.className = 'filter-section-card';

                    const header = document.createElement('div');
                    header.className = 'filter-section-header';
                    header.innerHTML = `<h4>${title}</h4><i class="fas fa-chevron-down"></i>`;

                    const body = document.createElement('div');
                    body.className = 'filter-section-body';

                    header.onclick = () => {
                        const isOpening = !header.classList.contains('active');
                        header.classList.toggle('active');
                        body.classList.toggle('show');
                        if (isOpening) {
                            setTimeout(() => sectionCard.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                        }
                    };

                    // Lineaire collectie van siblings vanaf de header-container
                    let itemsAdded = 0;
                    let nextSib = headerContainer.nextElementSibling;

                    while (nextSib) {
                        // Stop als we de volgende header tegenkomen
                        if (nextSib.querySelector('.befalow') || nextSib.tagName === 'HR') break;

                        // Case 1: Directe checkbox
                        if (nextSib.classList.contains('form-check')) {
                            const item = createFilterItem(nextSib);
                            if (item) { body.appendChild(item); itemsAdded++; }
                        }

                        // Case 2: Sub-dropdown trigger (A) en bijbehorende content (DIV.collapse)
                        else if (nextSib.tagName === 'A' && (nextSib.classList.contains('btn') || nextSib.hasAttribute('data-bs-toggle'))) {
                            const subTitle = nextSib.innerText.trim();
                            const collapseDiv = nextSib.nextElementSibling;

                            if (collapseDiv && collapseDiv.classList.contains('collapse') && subTitle) {
                                const subToggle = document.createElement('div');
                                subToggle.className = 'filter-sub-toggle';
                                subToggle.innerHTML = `<span>${subTitle}</span><i class="fas fa-caret-right"></i>`;

                                const subBody = document.createElement('div');
                                subBody.className = 'filter-sub-content';

                                subToggle.onclick = (e) => {
                                    e.stopPropagation();
                                    subToggle.classList.toggle('active');
                                    subBody.classList.toggle('show');
                                };

                                // Vul sub-body met checkboxes uit de collapse div
                                let subItemsCount = 0;
                                collapseDiv.querySelectorAll('.form-check').forEach(subCheck => {
                                    const subFilterItem = createFilterItem(subCheck);
                                    if (subFilterItem) {
                                        subBody.appendChild(subFilterItem);
                                        subItemsCount++;
                                    }
                                });

                                if (subItemsCount > 0) {
                                    body.appendChild(subToggle);
                                    body.appendChild(subBody);
                                    itemsAdded++;
                                }
                            }
                        }

                        // Case 3: Sub-titels (zoals Laagseizoen/Hoogseizoen)
                        else if (nextSib.innerText.trim().length > 1 && nextSib.innerText.trim().length < 50 && !nextSib.querySelector('input')) {
                            const txt = nextSib.innerText.trim();
                            const subTitle = document.createElement('div');
                            subTitle.style.fontWeight = 'bold';
                            subTitle.style.marginTop = '10px';
                            subTitle.style.fontSize = '14px';
                            subTitle.style.color = '#666';
                            subTitle.textContent = txt;
                            body.appendChild(subTitle);
                        }

                        nextSib = nextSib.nextElementSibling;
                    }

                    if (itemsAdded > 0) {
                        sectionCard.appendChild(header);
                        sectionCard.appendChild(body);
                        content.appendChild(sectionCard);
                    }
                });

                logDebug("Filters succesvol verwerkt");
            } else {
                logDebug("Geen HTML ontvangen voor filters");
                loading.style.display = 'none';
                content.innerHTML = '<div style="padding:20px;text-align:center;">Geen filters beschikbaar</div>';
            }
        } catch (e) {
            logDebug("Filter Fout: " + e.message);
            loading.style.display = 'none';
            content.innerHTML = '<div style="padding:20px;text-align:center;">Fout bij ophalen filters</div>';
        } finally {
            window.isFetchingFilters = false;
        }
    }

    // Hulpfunctie om filteritems te maken zoals in de originele Android app
    function createFilterItem(webNode) {
        const input = webNode.querySelector('input');
        if (!input) return null;
        const guid = input.getAttribute('data-filter-id') || input.id;
        const name = webNode.querySelector('label')?.innerText.trim() || "Onbekend";

        if (!guid || guid === "null") return null;

        const checked = (window.currentFilters || []).includes(guid) ? 'checked' : '';

        const div = document.createElement('div');
        div.className = 'filter-item';
        div.innerHTML = `<input type="checkbox" value="${guid}" ${checked} onchange="window.onFilterChange()"><label style="flex-grow: 1; cursor: pointer;" onclick="this.previousElementSibling.click()">${name}</label>`;
        return div;
    }

    // Functie om de actieve filters UI bij te werken zoals in de originele Android app
    function updateActiveFiltersUI(selectedItems) {
        const tagsContainer = overlay.querySelector('#active-tags-container');
        const activeHolder = overlay.querySelector('#active-filters-holder');
        const overlayContent = overlay.querySelector('#svr-filter-overlay-content');

        tagsContainer.innerHTML = '';
        const oldHeight = activeHolder.style.display !== 'none' ? activeHolder.offsetHeight : 0;

        if (selectedItems.length > 0) {
            activeHolder.style.display = 'block';
            selectedItems.forEach(item => {
                const tag = document.createElement('span');
                tag.className = 'active-filter-tag';
                tag.innerText = item.name;
                tagsContainer.appendChild(tag);
            });
        } else {
            activeHolder.style.display = 'none';
        }

        // Gebruik een kleine delay om de browser de nieuwe hoogte te laten berekenen
        setTimeout(() => {
            const newHeight = activeHolder.style.display !== 'none' ? activeHolder.offsetHeight : 0;
            const diff = newHeight - oldHeight;

            if (newHeight > 0) {
                overlayContent.style.scrollPaddingTop = (newHeight + 15) + 'px';
            } else {
                overlayContent.style.scrollPaddingTop = '15px';
            }

            // Als de hoogte is veranderd en we zijn niet helemaal bovenaan,
            // pas dan de scrollpositie aan zodat de content "meezakt"
            if (diff !== 0 && overlayContent.scrollTop > 0) {
                overlayContent.scrollBy({ top: -diff, behavior: 'instant' });
            }
        }, 1);
    }

    // Functie die wordt aangeroepen wanneer een filter verandert
    window.onFilterChange = function() {
        const selected = [];
        overlay.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
            selected.push({ guid: cb.value, name: cb.parentElement.querySelector('label').innerText });
        });
        updateActiveFiltersUI(selected);
    };

    overlay.querySelector('#svr-filter-apply-btn').onclick = function() {
        const selectedGuids = [];
        overlay.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => selectedGuids.push(cb.value));
        window.currentFilters = selectedGuids;

        const btn = document.getElementById('filterBtn');
        if (selectedGuids.length > 0) {
            btn.style.background = 'var(--svr-blue)';
            btn.style.color = 'white';
        } else {
            btn.style.background = 'white';
            btn.style.color = '#333';
        }

        window.closeFilterOverlay();
        window.performSearch(true); // Force API call for filter changes
    };

    // Wis filters functionaliteit
    window.resetFilters = function() {
        overlay.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        window.currentFilters = [];
        const btn = document.getElementById('filterBtn');
        btn.style.background = 'white';
        btn.style.color = '#333';

        // Leeg de actieve filters UI
        const activeHolder = overlay.querySelector('#active-filters-holder');
        activeHolder.style.display = 'none';
        overlay.querySelector('#active-tags-container').innerHTML = '';

        // Verwijder cookies zoals in de originele Android app
        const expires = "; expires=Thu, 01 Jan 1970 00:00:00 GMT";
        document.cookie = "filters=[]; expires=" + expires + "; path=/; domain=svr.nl";

        window.closeFilterOverlay();
        window.performSearch(true); // Force API call for resetting filters
    };

    // Voeg click handler toe aan de reset knop
    overlay.querySelector('#svr-filter-reset-btn').onclick = window.resetFilters;

    window.fetchFilterData = fetchFilterData;

})();

// --- MAP & CORE LOGIC ---
let isListView = false;
let isSearching = false;
logDebug("Map init...");
const map = L.map('map', { zoomControl: false }).setView([52.1326, 5.2913], 8);
const markerCluster = L.markerClusterGroup();
const top10Layer = L.featureGroup();
let centerMarker = null;
let currentUserLatLng = null;
let userLocationMarker = null;

const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OSM' }).addTo(map);
tiles.on('tileload', () => { if(!window.tilesLogged) { logDebug("Tegels OK"); window.tilesLogged=true; } });
map.addLayer(markerCluster); map.addLayer(top10Layer);

map.on('locationfound', (e) => { 
    if (!currentUserLatLng || currentUserLatLng.distanceTo(e.latlng) > 100) {
        logDebug("Loc: " + e.latlng.lat.toFixed(3) + "," + e.latlng.lng.toFixed(3));
        currentUserLatLng = e.latlng;
    }

    // Update or create user location marker
    if (userLocationMarker) {
        userLocationMarker.setLatLng(e.latlng);
    } else {
        userLocationMarker = L.marker(e.latlng, {
            icon: L.divIcon({
                className: 'user-location-dot',
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            }),
            zIndexOffset: 1000
        }).addTo(map);
    }
});
map.locate({ watch: false, enableHighAccuracy: true });

$('#locateBtn').on('click', () => {
    if (currentUserLatLng) map.setView(currentUserLatLng, 10);
    else map.locate({ setView: true, maxZoom: 10 });
});

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; const p1 = lat1 * Math.PI/180, p2 = lat2 * Math.PI/180;
    const dLat = (lat2-lat1) * Math.PI/180, dLon = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function applyState(state) {
    if (!state) return;

    // Only hide detail container if the new state is NOT a detail view
    // This prevents the hide/show flash when updating detail content
    if (state.view !== 'detail') {
        $('#detail-container').hide().removeClass('open');
    }

    // Hide main containers
    $('#map-container').hide();
    $('#list-container').hide();

    // Reset button visibility
    $('#locateBtn').hide();
    $('#scroll_top_btn').removeClass('visible').hide();

    switch (state.view) {
        case 'list':
            isListView = true;
            $('#list-container').show();
            $('#toggleView i').attr('class', 'fas fa-map');
            // Show scroll button on list view to maintain stack size
            $('#scroll_top_btn').addClass('visible').show();
            break;
        case 'map':
            isListView = false;
            $('#map-container').show();
            $('#locateBtn').show(); // Show locate only on map
            $('#toggleView i').attr('class', 'fas fa-list');
            setTimeout(() => {
                map.invalidateSize();
                if (window.lastMapBounds) {
                    map.fitBounds(window.lastMapBounds, { padding: [50, 50] });
                }
            }, 100);
            break;
        case 'detail':
            isListView = false;
            $('#detail-container').show(); // Ensure visible, but showSVRDetailPage handles the 'open' class
            break;
        default:
            isListView = false;
            $('#map-container').show();
            $('#locateBtn').show();
            $('#toggleView i').attr('class', 'fas fa-list');
            setTimeout(() => map.invalidateSize(), 100);
            break;
    }
}

// --- SCROLL TO TOP LOGIC ---
$('#list-container').on('scroll', function() {
    if (isListView) {
        if ($(this).scrollTop() > 300) {
            $('#scroll_top_btn').css('opacity', '1');
        } else {
            $('#scroll_top_btn').css('opacity', '0.5');
        }
    }
});

$('#scroll_top_btn').on('click', function() {
    $('#list-container').animate({ scrollTop: 0 }, 400);
});

// Function to handle showing the detail page with bottom-up animation
window.showSVRDetailPage = function(objectId) {
    const detailOverlay = document.getElementById('detail-container');
    const detailSheet = detailOverlay.querySelector('.detail-sheet-content');
    const splashScreen = document.getElementById('detail-splash');
    const backdrop = document.getElementById('svr-filter-backdrop');

    // CRITICAL FIX: Explicitly remove transform property and force reflow
    detailSheet.style.removeProperty('transform');
    detailSheet.style.transition = 'none';
    void detailSheet.offsetWidth;
    detailSheet.style.transition = '';

    // Show splash screen immediately
    if (splashScreen) {
        splashScreen.classList.remove('hide'); // Make sure it's visible
        typewriterEffect('detail-splash-text', 'Kamperen bij de boer'); // Start typewriter effect
        // Clear actual content area, but don't remove splash
        const elementsToClear = Array.from(detailSheet.children).filter(el => el.id !== 'detail-splash');
        elementsToClear.forEach(el => el.remove());
    } else {
        // Fallback if splash not found (shouldn't happen with correct HTML)
        $(detailSheet).empty();
    }

    // Show backdrop and overlay
    if (backdrop) {
        backdrop.style.display = 'block';
        setTimeout(() => backdrop.classList.add('open'), 10);
    }
    detailOverlay.style.display = 'block';

    setTimeout(() => {
        detailOverlay.classList.add('open');
        // Push state and fetch content
        history.pushState({ view: 'detail', objectId: objectId }, "", `#detail/${objectId}`);
        renderDetail(objectId); // renderDetail will now hide the splash when content is ready
    }, 10);
};

// Function to handle the back action for the detail sheet (no changes here)
window.handleDetailBack = function() {
    const detailOverlay = document.getElementById('detail-container');
    const detailSheet = detailOverlay.querySelector('.detail-sheet-content');
    const backdrop = document.getElementById('svr-filter-backdrop');
    const splashScreen = document.getElementById('detail-splash');


    detailSheet.classList.remove('open'); // Trigger slide down
    detailOverlay.classList.remove('open'); // Trigger background fade out
    if (backdrop) backdrop.classList.remove('open');
    if (splashScreen) splashScreen.classList.add('hide'); // Hide splash instantly on back

    setTimeout(() => {
        detailOverlay.style.display = 'none'; // Hide after animation
        if (backdrop && !document.getElementById('svr-filter-overlay').classList.contains('open')) {
            backdrop.style.display = 'none';
        }
        if (history.state && history.state.view === 'detail') {
            history.back(); // Navigate back in history
        }
        // Ensure splash is completely gone from DOM after fade-out
        if (splashScreen) {
            splashScreen.classList.remove('hide'); // Reset for next use
            // The splash screen should remain in the DOM, just hidden, ready for next detail view
        }
    }, 400); // Match CSS transition duration
};


// Update onpopstate to handle the sheet animation on history changes
window.onpopstate = (e) => {
    const detailOverlay = document.getElementById('detail-container');
    const detailSheet = detailOverlay.querySelector('.detail-sheet-content');
    const backdrop = document.getElementById('svr-filter-backdrop');
    const splashScreen = document.getElementById('detail-splash');


    if (e.state) {
        applyState(e.state);
        if (e.state.view === 'detail' && e.state.objectId) {
            // Show splash and start typewriter effect
            if (splashScreen) {
                splashScreen.classList.remove('hide');
                typewriterEffect('detail-splash-text', 'Kamperen bij de boer');
                 // Clear actual content area, but don't remove splash
                const elementsToClear = Array.from(detailSheet.children).filter(el => el.id !== 'detail-splash');
                elementsToClear.forEach(el => el.remove());
            }

            if (backdrop) {
                backdrop.style.display = 'block';
                setTimeout(() => backdrop.classList.add('open'), 10);
            }
            detailOverlay.style.display = 'block';
            setTimeout(() => {
                detailOverlay.classList.add('open');
                detailSheet.classList.add('open'); // This will trigger the slide up animation
                renderDetail(e.state.objectId); // This will fetch content and hide splash
            }, 10);
        } else if (e.state.view === 'list' || e.state.view === 'map') {
            detailSheet.classList.remove('open');
            detailOverlay.classList.remove('open');
            if (backdrop) backdrop.classList.remove('open');
            if (splashScreen) splashScreen.classList.add('hide'); // Hide splash instantly on state change

            setTimeout(() => {
                detailOverlay.style.display = 'none';
                if (backdrop) backdrop.style.display = 'none';
            }, 400);
        }
    } else {
        // Fallback if state is null (e.g., initial page load or unmanaged history entry)
        applyState({ view: 'map' }); // Default to map view
        detailSheet.classList.remove('open');
        detailOverlay.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
        if (splashScreen) splashScreen.classList.add('hide'); // Hide splash instantly on fallback

        setTimeout(() => {
            detailOverlay.style.display = 'none';
            if (backdrop) backdrop.style.display = 'none';
        }, 400);
    }
};

$('#toggleView').on('click', () => { isListView = !isListView; applyState({ view: isListView ? 'list' : 'map' }); history.pushState({ view: isListView ? 'list' : 'map' }, ""); });

const $searchInput = $('#searchInput'); const $suggestionsList = $('#suggestionsList');

// Clear search input on click if it has a value
$searchInput.on('click', function() {
    if ($(this).val().length > 0) {
        $(this).val('');
        $suggestionsList.hide();
    }
});

// Trigger search on Enter key
$searchInput.on('keydown', function(e) {
    if (e.key === 'Enter') {
        $suggestionsList.hide();
        window.performSearch();
    }
});

// Trigger search on Icon click
$('#searchIcon').on('click', function() {
    $suggestionsList.hide();
    window.performSearch();
});

$searchInput.on('input', function() {
    const q = $(this).val(); if (q.length < 2) { $suggestionsList.hide(); return; }
    const suggestions = window.getSuggestionsLocal(q);
    $suggestionsList.empty();
    if (suggestions.length === 0) { $suggestionsList.hide(); return; }
    suggestions.forEach(p => {
        const $li = $('<li class="suggestion-item"></li>').text(p);
        $li.on('click', () => { $searchInput.val(p); $suggestionsList.hide(); window.performSearch(); });
        $suggestionsList.append($li);
    });
    $suggestionsList.show();
});

window.performSearch = async function(forceAPI = false) {
    if (isSearching) return;
    isSearching = true;

    // Hide keyboard
    $searchInput.blur();

    const q = $searchInput.val().trim();
    let sLat = 52.1326, sLng = 5.2913;

    if (q) {
        const coords = await window.getCoordinatesWeb(q);
        if (coords) {
            sLat = coords.latitude; sLng = coords.longitude;
        } else {
            // Feedback for invalid location
            const originalPlaceholder = $searchInput.attr('placeholder');
            $searchInput.val('').attr('placeholder', 'Plaats niet gevonden...').addClass('search-error');
            setTimeout(() => {
                $searchInput.attr('placeholder', originalPlaceholder).removeClass('search-error');
            }, 3000);
            isSearching = false;
            return;
        }
    } else if (currentUserLatLng) {
        sLat = currentUserLatLng.lat; sLng = currentUserLatLng.lng;
    }

    // Update de rode punaise naar de nieuwe locatie
    if (centerMarker) map.removeLayer(centerMarker);
    centerMarker = L.marker([sLat, sLng], {
        icon: L.divIcon({
            className: 'search-marker',
            html: '<i class="fa-solid fa-map-pin" style="color:#c0392b;font-size:30px;"></i>',
            iconSize:[30,30],
            iconAnchor:[15,30]
        }),
        zIndexOffset: 2000
    }).addTo(map);

    // Instant Search: Als we niet forceren (geen filterwijziging) en we hebben data, dan rekenen we het lokaal uit
    if (!forceAPI && window.hasDataOnScreen) {
        const cached = localStorage.getItem('svr_cache_campsites');
        if (cached) {
            logDebug("Instant Search via Cache (Volledige lijst)...");
            const objects = JSON.parse(cached);

            // Bereken afstanden voor ALLE campings in de cache
            objects.forEach(o => {
                o.distM = o.geometry ? calculateDistance(sLat, sLng, o.geometry.coordinates[1], o.geometry.coordinates[0]) : 999999;
            });

            // Sorteer de volledige lijst
            objects.sort((a, b) => a.distM - b.distM);

            // Render de volledige set
            renderResults(objects, sLat, sLng);
            isSearching = false;
            return;
        }
    }

    // Alleen spinner tonen als we echt een API-call gaan doen
    $('#loading-overlay').css('display', 'flex');

    try {
        // Gebruik een ruime straal voor de API-call om de cache zo compleet mogelijk te maken
        let apiUrl = `https://www.svr.nl/api/objects?page=0&lat=${sLat}&lng=${sLng}&distance=500000&limit=2000`;
        if (window.currentFilters && window.currentFilters.length > 0) {
            window.currentFilters.forEach(f => apiUrl += `&filter[facilities][]=${f}`);
        }

        const contents = await fetchWithRetry(apiUrl);

        if (!contents || contents.trim().startsWith("<!doctype") || contents.trim().startsWith("<html") || contents.includes("Internal Server Error")) {
            throw new Error("SVR stuurde geen geldige JSON");
        }

        const data = JSON.parse(contents);
        const allObjects = data.objects || [];

        // Filter out objects where type_camping === 3
        const objects = allObjects.filter(o => {
            const props = o.properties;
            if (props) {
                const typeCamping = props.type_camping !== undefined ? props.type_camping : -1;
                return typeCamping !== 3;
            }
            return true;
        });

        logDebug("API resultaten ontvangen. Aantal: " + objects.length);

        // Strip data om binnen de localStorage limiet van 5MB te blijven
        const strippedObjects = objects.map(o => ({
            id: o.id,
            geometry: o.geometry,
            properties: {
                name: o.properties.name,
                city: o.properties.city,
                type_camping: o.properties.type_camping,
                facilities: o.properties.facilities,
                address: o.properties.address
            }
        }));

        // Cache de resultaten
        try {
            localStorage.setItem('svr_cache_campsites', JSON.stringify(strippedObjects));
            logDebug(`Cache bijgewerkt (${strippedObjects.length} items).`);
        } catch(e) { logDebug("Cache Opslag Fout: " + e.message); }

        objects.forEach(o => { o.distM = o.geometry ? calculateDistance(sLat, sLng, o.geometry.coordinates[1], o.geometry.coordinates[0]) : 999999; });
        objects.sort((a, b) => a.distM - b.distM);
        renderResults(objects, sLat, sLng);
        window.hasDataOnScreen = true;
        setTimeout(() => map.invalidateSize(), 500);

    } catch (e) { logDebug("Search fout: " + e.message); }
    finally { $('#loading-overlay').hide(); isSearching = false; }
}

async function renderDetail(objectId) {
    const detailSheet = document.querySelector('#detail-container .detail-sheet-content');
    const splashScreen = document.getElementById('detail-splash');

    // Ensure splash is visible before fetch
    if (splashScreen) {
        splashScreen.classList.remove('hide');
        // Typewriter effect already started in showSVRDetailPage
    }

    try {
        const PROXY_BASE_URL = 'https://svr-proxy-worker.e60-manuels.workers.dev';
        const detailUrl = `${PROXY_BASE_URL}/object/${objectId}`;

        logDebug(`Fetching SVR detail page for ${objectId} via proxy: ${detailUrl}`);
        const htmlContent = await fetchWithRetry(detailUrl);

        if (!htmlContent || htmlContent.includes("Internal Server Error")) {
            throw new Error("SVR response invalid or empty");
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');

        const bodyContent = doc.body;

        bodyContent.querySelectorAll('nav, header, .navbar, .container-fluid.p-0.text-center, .modal, #map_detail').forEach(el => {
            el.remove();
        });

        if (bodyContent.innerHTML.trim().length > 0) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = bodyContent.innerHTML;

            tempDiv.querySelectorAll('script, link').forEach(el => el.remove());

            tempDiv.querySelectorAll('img').forEach(img => {
                img.classList.remove('d-none');
                img.removeAttribute('loading');
            });

            const SVR_BASE = 'https://www.svr.nl';
            tempDiv.querySelectorAll('[src], [href]').forEach(element => {
                const attr = element.hasAttribute('src') ? 'src' : 'href';
                let url = element.getAttribute(attr);
                if (url && url.startsWith('/') && !url.startsWith('//')) {
                    element.setAttribute(attr, SVR_BASE + url);
                }
            });

            const containerStyle = document.createElement('style');
            containerStyle.innerHTML = `
                #detail-container .container, #detail-container .container-fluid {
                    width: 100% !important; max-width: 100vw !important;
                    padding: 0 !important; margin: 0 !important;
                    box-sizing: border-box !important;
                }
                #detail-container .row {
                    width: 100% !important; margin: 0 !important; padding: 0 !important;
                    display: flex !important; flex-direction: column !important;
                    box-sizing: border-box !important;
                }
                #detail-container .col-md-8, #detail-container .col-md-4,
                #detail-container .col-sm-8, #detail-container .col-sm-4,
                #detail-container .col-sm-6, #detail-container .col-sm-12,
                #detail-container .col-6, #detail-container .col-12 {
                    width: 100% !important; max-width: 100% !important;
                    padding: 10px 15px !important; margin: 0 !important;
                    box-sizing: border-box !important;
                    float: none !important;
                    display: block !important;
                }
                #detail-container img, #detail-container iframe {
                    max-width: 100% !important;
                    height: auto !important;
                    box-sizing: border-box !important;
                }
                /* Specific fix for iframe aspect ratio */
                #detail-container iframe { aspect-ratio: 16 / 9; }

                /* Fix for Tarieven (Pricing Table) */
                #detail-container .object_pricing {
                    font-size: 16px !important;
                    width: 100% !important;
                    overflow-x: auto !important;
                }
                #detail-container .object_pricing table {
                    width: 100% !important;
                    table-layout: auto !important;
                    border-collapse: collapse !important;
                }
                #detail-container .object_pricing td {
                    width: auto !important; /* Overrule hardcoded 380px */
                    padding: 8px 5px !important;
                    border-bottom: 1px solid #eee !important;
                }
                #detail-container .object_pricing td:not(:first-child) {
                    width: 65px !important; /* Fixed width for 'Normaal' and 'All-in' columns */
                    text-align: center !important;
                }

                /* Fix for Faciliteiten (Facilities List) */
                #detail-container .restorelines {
                    line-height: 1.6 !important;
                    font-size: 16px !important;
                    padding-left: 0 !important; /* Force 0 to align with description */
                    padding-top: 2px !important;
                    padding-bottom: 2px !important;
                    display: block !important;
                }
                /* Remove column padding for facilities to prevent double indentation */
                #detail-container .col-sm-12:has(.restorelines),
                #detail-container .col-sm-6:has(.restorelines),
                #detail-container .col-12:has(.restorelines),
                #detail-container .col-6:has(.restorelines) {
                    padding-left: 0 !important;
                }

                /* Align and expand the yellow header bar for Facilities */
                #detail-container .p-2[style*="background-color:#FDCC01"] {
                    padding-left: 0 !important;
                    margin-left: -15px !important;
                    width: calc(100% + 30px) !important;
                    box-sizing: border-box !important;
                }
                #detail-container .p-2[style*="background-color:#FDCC01"] h5 {
                    margin: 0 !important;
                    padding-left: 15px !important; /* Keep text indent in the bar */
                    font-family: 'Befalow', sans-serif !important;
                }

                #detail-container .footer {
                    background-color: #008AD3 !important;
                    color: black !important;
                    padding: 3rem 1.5rem !important;
                    margin-top: 2rem !important;
                }
                #detail-container .footer a { color: black !important; text-decoration: underline; }
                #detail-container .footer h3 { color: black !important; font-family: 'Befalow', sans-serif; }

                #detail-container .pt-5 { padding-top: 1.5rem !important; }
            `;
            tempDiv.prepend(containerStyle);

            const closeBtn = `<div class="detail-header" style="position: sticky; top: 0; background: #FDCC01; padding: 10px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; z-index: 10001; box-shadow: 0 2px 5px rgba(0,0,0,0.1); cursor: grab;">
                <div style="width: 40px; height: 5px; background: #BBB; border-radius: 3px; margin-bottom: 8px;"></div>
                <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 0 5px;">
                    <button onclick="window.handleDetailBack()" style="background: none; border: none; font-size: 20px; cursor: pointer; padding: 5px; color: #333;"><i class="fas fa-arrow-left"></i></button>
                    <h3 style="margin: 0; font-family: 'Befalow'; color: #333; font-size: 1.2rem;">Camping Details</h3>
                    <div style="width: 30px;"></div>
                </div>
            </div>`;

            // Hide splash and then append content after a short delay for smooth transition
            if (splashScreen) {
                splashScreen.classList.add('hide'); // Start fade out
                setTimeout(() => {
                    // Remove splash from DOM after it fades out, then add content
                    // Keep the actual splash element in the DOM (but hidden) so it can be reused
                    // The direct children of detailSheet are now just the splash, which is hidden,
                    // and any previously loaded content (which we need to remove before appending new).
                    const elementsToClear = Array.from(detailSheet.children).filter(el => el.id !== 'detail-splash');
                    elementsToClear.forEach(el => el.remove());

                    $(detailSheet).append(closeBtn);
                    detailSheet.appendChild(tempDiv);

                    // Re-enable swipe
                    window.enableSwipeToClose(detailSheet, window.handleDetailBack, '.detail-header');

                    // Inject scripts
                    setTimeout(() => {
                        try {
                            logDebug("Initializing bulletproof Swiper...");

                            const mainImageContainer = detailSheet.querySelector('div.row.m-0.p-4.mt-0');

                            if (mainImageContainer && !mainImageContainer.dataset.swiperInitialized) {
                                let images = [];
                                const imageCards = mainImageContainer.querySelectorAll('div.card');

                                imageCards.forEach(card => {
                                    const img = card.querySelector('img');
                                    if (img && img.src) {
                                        images.push(img.src);
                                    }
                                });

                                logDebug(`Found ${images.length} images for carousel.`);

                                if (images.length > 0) {
                                    mainImageContainer.dataset.swiperInitialized = 'true';

                                    const swiperContainer = document.createElement('div');
                                    swiperContainer.className = 'swiper svr-detail-swiper';
                                    swiperContainer.style.width = '100%';
                                    swiperContainer.style.height = '300px';
                                    swiperContainer.style.position = 'relative';
                                    swiperContainer.style.touchAction = 'pan-y';
                                    swiperContainer.style.overflow = 'hidden';
                                    swiperContainer.style.marginBottom = '20px';

                                    const swiperWrapper = document.createElement('div');
                                    swiperWrapper.className = 'swiper-wrapper';

                                    images.forEach(src => {
                                        const swiperSlide = document.createElement('div');
                                        swiperSlide.className = 'swiper-slide';
                                        swiperSlide.style.display = 'flex';
                                        swiperSlide.style.alignItems = 'center';
                                        swiperSlide.style.justifyContent = 'center';
                                        swiperSlide.style.width = '100%';

                                        const imgElement = document.createElement('img');
                                        imgElement.src = src;
                                        imgElement.style.width = '100%';
                                        imgElement.style.height = '100%';
                                        imgElement.style.objectFit = 'cover';

                                        swiperSlide.appendChild(imgElement);
                                        swiperWrapper.appendChild(swiperSlide);
                                    });

                                    swiperContainer.appendChild(swiperWrapper);

                                    const pagination = document.createElement('div');
                                    pagination.className = 'swiper-pagination';
                                    swiperContainer.appendChild(pagination);

                                    mainImageContainer.parentNode.replaceChild(swiperContainer, mainImageContainer);

                                    if (typeof Swiper !== 'undefined') {
                                        new Swiper(swiperContainer, {
                                            direction: 'horizontal',
                                            loop: images.length > 1,
                                            speed: 400,
                                            roundLengths: true,
                                            observer: true,
                                            observeParents: true,
                                            pagination: {
                                                el: '.swiper-pagination',
                                                clickable: true,
                                            },
                                            threshold: 10,
                                            followFinger: true,
                                            touchStartPreventDefault: false,
                                            on: {
                                                init: function () {
                                                    const self = this;
                                                    setTimeout(() => self.update(), 500);
                                                    setTimeout(() => self.update(), 1500);
                                                },
                                            },
                                        });
                                        logDebug("Robust Swiper initialized successfully.");
                                    }
                                }
                            } else {
                                const carousel = detailSheet.querySelector('.carousel');
                                if (carousel) {
                                    logDebug("Fallback: Converting Bootstrap Carousel to Swiper...");
                                    carousel.classList.remove('carousel', 'slide', 'pointer-event');
                                    carousel.classList.add('swiper');

                                    const inner = carousel.querySelector('.carousel-inner');
                                    if (inner) {
                                        inner.classList.remove('carousel-inner');
                                        inner.classList.add('swiper-wrapper');

                                        inner.querySelectorAll('.carousel-item').forEach((item, idx) => {
                                            item.classList.remove('carousel-item', 'active');
                                            item.classList.add('swiper-slide');
                                            item.style.display = 'block';
                                            item.style.float = 'none';
                                            item.style.marginRight = '0';
                                            item.style.height = 'auto';
                                        });
                                    }

                                    carousel.querySelectorAll('.carousel-control-prev, .carousel-control-next').forEach(el => el.remove());

                                    if (!carousel.querySelector('.swiper-pagination')) {
                                        const pagination = document.createElement('div');
                                        pagination.className = 'swiper-pagination';
                                        carousel.appendChild(pagination);
                                    }

                                    if (typeof Swiper !== 'undefined') {
                                        new Swiper(carousel, {
                                            loop: true,
                                            autoHeight: true,
                                            pagination: {
                                                el: '.swiper-pagination',
                                                clickable: true,
                                            },
                                        });
                                    }
                                }
                            }

                            detailSheet.querySelectorAll('.befalow').forEach(el => el.style.setProperty('font-family', "'Befalow', sans-serif", 'important'));
                        } catch(err) { console.error("Error during post-injection script execution:", err); }
                    }, 600);
                }, 500); // Wait for splash fade out transition
            }
        } else { throw new Error("Geen detailinhoud gevonden."); }
    } catch (e) {
        logDebug("Detail Fout: " + e.message);
        // Ensure splash is hidden if an error occurs
        if (splashScreen) splashScreen.classList.add('hide');
        const elementsToClear = Array.from(detailSheet.children).filter(el => el.id !== 'detail-splash');
        elementsToClear.forEach(el => el.remove());
        $(detailSheet).append(`<div style="padding:40px;text-align:center;"><h3>Fout</h3><p>${e.message}</p><button onclick="window.handleDetailBack()">Terug</button></div>`);
    }
}

window.focusOnMarker = function(lat, lng, objectId) {
    applyState({ view: 'map' });
    const targetLatLng = L.latLng(lat, lng);
    const standardZoom = 14; 
    window.skipFitBounds = true;

    // Find the marker by ID
    let foundMarker = null;
    markerCluster.eachLayer(m => { if (m.objId === objectId) foundMarker = m; });
    if (!foundMarker) {
        top10Layer.eachLayer(m => { if (m.objId === objectId) foundMarker = m; });
    }

    const finalizeFocus = () => {
        // Force the standard zoom level and position
        map.setView(targetLatLng, standardZoom, { animate: true });
        
        // Wait for the final movement to finish before opening popup
        setTimeout(() => {
            if (foundMarker) {
                foundMarker.openPopup();
            }
        }, 300);
    };

    if (foundMarker) {
        if (markerCluster.hasLayer(foundMarker)) {
            // zoomToShowLayer handles the cluster expansion
            markerCluster.zoomToShowLayer(foundMarker, finalizeFocus);
        } else {
            finalizeFocus();
        }
    } else {
        map.setView(targetLatLng, standardZoom);
    }
    
    // Lock fitBounds for a bit longer to ensure stability
    setTimeout(() => { window.skipFitBounds = false; }, 4000);
};

function renderResults(objects, cLat, cLng) {
    markerCluster.clearLayers(); top10Layer.clearLayers(); $('#resultsList').empty();
    if (objects.length === 0) { $('#resultsList').append('<div style="padding:20px;text-align:center;">Geen campings gevonden.</div>'); return; }
    const bounds = L.latLngBounds([cLat, cLng]);
    objects.forEach((obj, index) => {
        const p = obj.properties, g = obj.geometry; if (!g) return;

        // Check the type_camping field - we should only include campsites where
        // type_camping is 0, 1, or 2
        // type_camping = 3 indicates the campsite does not apply to the current filters
        const typeCamping = p.type_camping !== undefined ? p.type_camping : -1; // Default to -1 if not found

        if (typeCamping === 3) {
            // Skip this campsite as it doesn't match the current filters
            return;
        }

        const lat = g.coordinates[1], lng = g.coordinates[0], safeName = btoa(unescape(encodeURIComponent(p.name)));
        const marker = L.marker([lat, lng]);
        marker.objId = obj.id; // Store ID for reliable lookup
        
        // Match original Android app popup styling exactly
        // See: bestanden/outerHTML_marker_popup.txt
        const address = p.address ? `${p.address}, ${p.city}` : p.city;
        const distDisplay = (obj.distM/1000).toFixed(1);
        
        const popup = `<div style="min-width: 220px;">
            <div style="word-wrap: break-word; margin-top: -5px;">
                <h5 onclick="window.showSVRDetailPage('${obj.id}')" style="margin: 0; padding: 0; font-family: 'Befalow', sans-serif; font-size: 25px; font-weight: normal; color: #008AD3; cursor: pointer;">${p.name}</h5>
                <div style="font-size: 13px; color: #666; margin-top: 0px;">${address}</div>
                <div style="font-size: 13px; color: #333; margin-top: 2px;"><i class="fa-solid fa-map-pin" style="color: #c0392b;"></i> Afstand: ${distDisplay} km</div>
                <div class="camping-actions" style="display: flex; margin: 8px -15px -15px -15px; border-top: 1px solid #eee;">
                    <a href="#" class="action-btn btn-route" style="flex: 1; text-align: center; padding: 6px 0; color: #c0392b; text-decoration: none; font-weight: bold; font-size: 14px; border-right: 1px solid #eee;" onclick="window.openNavHelper(${lat}, ${lng}, '${safeName}'); return false;"><i class="fa-solid fa-route"></i> ROUTE</a>
                    <a href="#" class="action-btn btn-info" style="flex: 1; text-align: center; padding: 6px 0; color: #008AD3; text-decoration: none; font-weight: bold; font-size: 14px;" onclick="window.showSVRDetailPage('${obj.id}'); return false;"><i class="fa-solid fa-circle-info"></i> INFO</a>
                </div>
            </div>
        </div>`;
        
        marker.bindPopup(popup);
        if (index < 10) { top10Layer.addLayer(marker); bounds.extend([lat, lng]); } else markerCluster.addLayer(marker);

        const card = `<div class="camping-card">
            <div class="card-body">
                <h3>${p.name}</h3>
                <div class="card-location"><i class="fa-solid fa-map-pin"></i> ${p.city}</div>
                <div class="card-distance"><i class="fa-solid fa-map-pin"></i> Afstand: ${(obj.distM/1000).toFixed(1)} km</div>
            </div>
            <div class="camping-actions">
                <a href="#" class="action-btn btn-kaart" onclick="window.focusOnMarker(${lat},${lng}, '${obj.id}'); return false;"><i class="fa-solid fa-map"></i> KAART</a>
                <a href="#" class="action-btn btn-route" onclick="window.openNavHelper(${lat}, ${lng}, '${safeName}'); return false;"><i class="fa-solid fa-route"></i> ROUTE</a>
                <a href="#" class="action-btn btn-info" onclick="window.showSVRDetailPage('${obj.id}'); return false;"><i class="fa-solid fa-circle-info"></i> INFO</a>
            </div>
        </div>`;
        $('#resultsList').append(card);
    });
    
    // Store bounds for later use
    window.lastMapBounds = bounds;
    
    // Only fit bounds if map is currently visible and we're not focusing on a marker
    if (!isListView && !window.skipFitBounds) {
        map.fitBounds(bounds, { padding: [50, 50] });
    }
}

window.showHelp = function() {
    const dynamicText = document.getElementById('dynamic-help-text');
    if (isListView) { dynamicText.innerText = 'Terug naar boven scrollen'; } 
    else { dynamicText.innerText = 'Toon jouw huidige locatie'; }
    document.getElementById('help-overlay').style.display = 'block';
};

// === LOGIN FUNCTIONALITEIT VOOR SVR PWA ===
async function checkSession() {
  try {
    const sessionId = localStorage.getItem('svr_session_id');
    const options = { headers: {} };

    if (sessionId) {
      options.headers['X-SVR-Session'] = sessionId;
      console.log('✅ Found session ID in localStorage, attempting to validate:', sessionId.substring(0, 20) + '...');
    } else {
      console.log('❌ No session ID found in localStorage.');
      return false;
    }
    
    const response = await fetch('https://svr-proxy-worker.e60-manuels.workers.dev/api/objects?page=0&lat=52.1326&lng=5.2913&distance=1&limit=1', options);
    
    if (response.ok) {
      console.log('✅ Bestaande sessie is nog geldig');
      return true;
    } else if (response.status === 401) {
      console.log('❌ Sessie verlopen (401), opnieuw inloggen vereist');
      localStorage.removeItem('svr_session_id'); // Clear invalid session
      return false;
    }
    console.log(`❌ Ongeldige sessie: Status ${response.status}`);
    localStorage.removeItem('svr_session_id'); // Clear invalid session
    return false;
  } catch (error) {
    console.error('Session check failed:', error);
    localStorage.removeItem('svr_session_id'); // Clear session on network error
    return false;
  }
}

async function loginToSVR(email, password) {
  try {
    const response = await fetch('https://svr-proxy-worker.e60-manuels.workers.dev/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
      // credentials: 'include' // Removed, as we manually manage session via localStorage and custom header
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.session_id) {
        localStorage.setItem('svr_session_id', data.session_id);
        console.log('✅ Session ID stored in localStorage:', data.session_id.substring(0, 20) + '...');
      } else {
        console.warn('Login successful but no session_id received in response.');
      }
      console.log('✅ Login succesvol:', data.message || 'Geen bericht');
      return true;
    } else {
      let errorData;
      try {
        errorData = await response.json(); // Probeer als JSON te parsen
      } catch (jsonError) {
        // Als JSON parsen faalt, haal dan de ruwe tekst op
        errorData = { message: `Worker error (non-JSON response): ${await response.text()}`, details: jsonError.message };
      }
      console.error('❌ Login mislukt:', errorData.message || errorData.details || 'Onbekende fout');
      alert('Login mislukt: ' + (errorData.message || errorData.details || 'Onbekende fout'));
      return false;
    }
  } catch (error) {
    console.error('Login error:', error);
    alert('Login fout: ' + error.message);
    return false;
  }
}

window.showLoginScreen = function() {
  if (document.getElementById('login-overlay')) return;

  const loginHtml = `
    <div id="login-overlay" style="
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.8); display: flex; justify-content: center; align-items: flex-start; padding-top: 10vh; z-index: 10000;
    ">
      <div style="
        background: white; padding: 30px; border-radius: 10px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 400px; width: 90%;
      ">
        <h2 style="margin-top: 0; color: #333;">SVR Login</h2>
        <p style="color: #666; margin-bottom: 20px;">Log in om de app te gebruiken</p>
        
        <input type="email" id="svr-email" placeholder="Email" style="width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box; font-size: 16px;">
        <div style="position: relative; margin-bottom: 20px;">
          <input type="password" id="svr-password" placeholder="Wachtwoord" style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box; font-size: 16px;">
          <i class="fas fa-eye" id="togglePassword" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); cursor: pointer; color: #666;"></i>
        </div>

        <button id="svr-login-btn" style="width: 100%; padding: 12px; background: #007bff; color: white; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; font-weight: bold;">Inloggen</button>
        <div id="login-error" style="color: red; margin-top: 15px; display: none;"></div>
        </div>
        </div>
        `;

        document.body.insertAdjacentHTML('beforeend', loginHtml);

        // Add toggle functionality
        const togglePassword = document.getElementById('togglePassword');
        const password = document.getElementById('svr-password');

        togglePassword.addEventListener('click', function (e) {
        // toggle the type attribute
        const type = password.getAttribute('type') === 'password' ? 'text' : 'password';
        password.setAttribute('type', type);
        // toggle the eye slash icon
        this.classList.toggle('fa-eye-slash');
        });  
  document.getElementById('svr-login-btn').addEventListener('click', async () => {
    const email = document.getElementById('svr-email').value;
    const password = document.getElementById('svr-password').value;
    
    if (!email || !password) {
      const err = document.getElementById('login-error');
      err.textContent = 'Vul email en wachtwoord in';
      err.style.display = 'block';
      return;
    }
    
    const btn = document.getElementById('svr-login-btn');
    btn.textContent = 'Bezig met inloggen...';
    btn.disabled = true;
    
    const success = await loginToSVR(email, password);
    
    if (success) {
      document.getElementById('login-overlay').remove();
      window.initializeApp();
    } else {
      btn.textContent = 'Inloggen';
      btn.disabled = false;
      const err = document.getElementById('login-error');
      err.textContent = 'Login mislukt, probeer opnieuw';
      err.style.display = 'block';
    }
  });
  
  document.getElementById('svr-password').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('svr-login-btn').click();
  });
}

async function initApp() {
  console.log('🚀 SVR PWA Start - Checking session...');
  const hasValidSession = await checkSession();
  
  if (hasValidSession) {
    console.log('✅ Sessie geldig, app starten...');
    window.initializeApp();
  } else {
    console.log('❌ Geen geldige sessie, login scherm tonen...');
    window.showLoginScreen();
  }
}

window.initializeApp = function() {
    history.replaceState({ view: 'map' }, "");
    
    // Set version display
    const verDisplay = document.getElementById('pwa-version-display');
    if (verDisplay) verDisplay.textContent = `v${window.SVR_PWA_VERSION}`;

    // Direct de kaart EN de lijst vullen vanuit cache of preset (Instant Map & List)
    // Dit gebeurt 100% lokaal, zonder API-call voor campings.
    window.loadCachedCampsites();
    
    // Start background fetch of filter checkboxes (vinkjes) with a small delay
    // This ensures the initial local render gets full CPU priority first.
    setTimeout(() => {
        if (window.fetchFilterData) {
            logDebug("Starting delayed background filter fetch...");
            window.fetchFilterData();
        }
    }, 1500);

    if (!localStorage.getItem('svr_help_shown')) {
        // Only set the flag if the help screen is shown as part of the initial flow
        window.shouldShowPWAAfterHelp = true; 
        setTimeout(() => { window.showHelp(); localStorage.setItem('svr_help_shown', 'true'); }, 2500);
    } else {
        // If help screen is not shown, or already shown, trigger PWA prompt check directly
        // after a slight delay to avoid interfering with initial load.
        setTimeout(() => { 
            // Only show prompt if it hasn't been handled via initial help screen.
            // In this 'else' block, it means help was NOT shown, so the prompt should show.
            window.shouldShowPWAAfterHelp = true; // Set flag to true for direct call
            window.closeHelpOverlayAndShowPWA(); 
        }, 3000); 
    }
};

// Function to close the help overlay and potentially show PWA install prompt
window.closeHelpOverlayAndShowPWA = function() {
    const helpOverlay = document.getElementById('help-overlay');
    if (helpOverlay) {
        helpOverlay.style.display = 'none';
        logDebug("Help overlay gesloten.");
    }
    
    // Only show the PWA prompt if the flag is set (meaning it's part of the initial flow)
    if (window.shouldShowPWAAfterHelp && window.isAppInstalled && !window.isAppInstalled()) {
        if (window.isIOS && window.isIOS()) {
            logDebug("Platform is iOS. Toon iOS instructies na sluiten help-overlay.");
            window.showIOSInstructions();
        } else if (window.showInstallPromotion) { // For Android/Desktop
            logDebug("Attempting to show PWA install promotion after help overlay close.");
            window.showInstallPromotion();
        }
    }
    window.shouldShowPWAAfterHelp = false; // Reset the flag after checking/showing
};

$(document).ready(() => {
    initApp();
});
