const state = {
    token: localStorage.getItem("route_ai_token") || "",
    map: null,
    userMarker: null,
    routeLayer: null,
    recording: false,
    mediaRecorder: null,
    audioChunks: [],
    audioContext: null,
    analyser: null,
    animationFrame: null,
    silenceTimer: null,
    stream: null,
    lastLocation: null
};

const $ = (id) => document.getElementById(id);

function setStatus(text) {
    const el = $("status");
    if (el) el.textContent = text;
}

function showAuth(show) {
    $("authPanel").style.display = show ? "flex" : "none";
    $("appPanel").style.display = show ? "none" : "flex";
}

async function api(url, options = {}) {
    const headers = options.headers || {};

    if (state.token) {
        headers.Authorization = `Bearer ${state.token}`;
    }

    if (options.body && !(options.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
        ...options,
        headers
    });

    let data = {};

    try {
        data = await response.json();
    } catch (_) {}

    if (!response.ok) {
        throw new Error(data.detail || `HTTP ${response.status}`);
    }

    return data;
}

function initMap() {
    state.map = L.map("map").setView([32.0853, 34.7818], 11);

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap contributors"
        }
    ).addTo(state.map);
}

function setLocation(lat, lon) {
    state.lastLocation = {
        lat,
        lon
    };

    if (!state.userMarker) {
        state.userMarker = L.marker([lat, lon]).addTo(state.map);
        state.userMarker.bindPopup("Ваше местоположение");
    } else {
        state.userMarker.setLatLng([lat, lon]);
    }
}

function locateUser(center = true) {
    if (!navigator.geolocation) {
        setStatus("Геолокация не поддерживается браузером.");
        return;
    }

    setStatus("Определяю ваше местоположение...");

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;

            setLocation(lat, lon);

            if (center) {
                state.map.setView([lat, lon], 14);
            }

            setStatus("Местоположение найдено.");
        },
        (error) => {
            setStatus(
                "Не удалось получить местоположение: " +
                error.message
            );
        },
        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 10000
        }
    );
}

async function geocode(place) {
    const params = new URLSearchParams({
        q: place,
        format: "json",
        limit: "1",
        addressdetails: "1"
    });

    const response = await fetch(
        `https://nominatim.openstreetmap.org/search?${params.toString()}`,
        {
            headers: {
                Accept: "application/json",
                "User-Agent": "MapNavAI/1.0"
            }
        }
    );

    if (!response.ok) {
        throw new Error("Ошибка геокодирования.");
    }

    const results = await response.json();

    if (!results.length) {
        throw new Error(
            `Не удалось найти место: ${place}`
        );
    }

    return {
        lat: Number(results[0].lat),
        lon: Number(results[0].lon),
        name: results[0].display_name
    };
}

async function buildRoute(from, to) {
    const url =
        "https://router.project-osrm.org/route/v1/driving/" +
        `${from.lon},${from.lat};${to.lon},${to.lat}` +
        "?overview=full&geometries=geojson&steps=true";

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error("Ошибка маршрутизатора.");
    }

    const data = await response.json();

    if (
        data.code !== "Ok" ||
        !data.routes ||
        !data.routes.length
    ) {
        throw new Error("Маршрут не найден.");
    }

    return data.routes[0];
}

function drawRoute(route) {
    if (state.routeLayer) {
        state.map.removeLayer(state.routeLayer);
    }

    state.routeLayer = L.geoJSON(
        route.geometry,
        {
            style: {
                weight: 6,
                opacity: 0.85
            }
        }
    ).addTo(state.map);

    state.map.fitBounds(
        state.routeLayer.getBounds(),
        {
            padding: [30, 30]
        }
    );
}

function formatDistance(meters) {
    if (meters < 1000) {
        return `${Math.round(meters)} м`;
    }

    return `${(meters / 1000).toFixed(1)} км`;
}

function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60);

    if (minutes < 60) {
        return `${minutes} мин`;
    }

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (mins) {
        return `${hours} ч ${mins} мин`;
    }

    return `${hours} ч`;
}

function showRouteInfo(route, destination) {
    const info = $("routeInfo");

    if (!info) return;

    info.innerHTML = `
        <strong>Маршрут построен</strong><br>
        До: ${escapeHtml(destination)}<br>
        Расстояние: ${formatDistance(route.distance)}<br>
        Время в пути: ${formatDuration(route.duration)}
    `;

    info.style.display = "block";
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

async function routeFromUserTo(place) {
    if (!state.lastLocation) {
        locateUser(false);

        await new Promise((resolve, reject) => {
            const started = Date.now();

            const timer = setInterval(() => {
                if (state.lastLocation) {
                    clearInterval(timer);
                    resolve();
                } else if (Date.now() - started > 16000) {
                    clearInterval(timer);
                    reject(
                        new Error(
                            "Не удалось получить ваше местоположение."
                        )
                    );
                }
            }, 200);
        });
    }

    setStatus(`Ищу ${place}...`);

    const destination = await geocode(place);

    setStatus("Строю маршрут...");

    const route = await buildRoute(
        state.lastLocation,
        destination
    );

    drawRoute(route);

    showRouteInfo(
        route,
        place
    );

    await saveRoute({
        destination: place,
        distance: route.distance,
        duration: route.duration,
        geometry: route.geometry
    });

    const answer =
        `Маршрут до ${place} построен. ` +
        `Расстояние ${formatDistance(route.distance)}, ` +
        `примерное время в пути ${formatDuration(route.duration)}.`;

    addMessage("AI", answer);

    speak(answer);

    setStatus("Готово.");
}

async function saveRoute(route) {
    try {
        await api("/api/routes", {
            method: "POST",
            body: JSON.stringify(route)
        });
    } catch (error) {
        console.warn(
            "Не удалось сохранить маршрут:",
            error
        );
    }
}

function addMessage(author, text) {
    const messages = $("messages");

    if (!messages) return;

    const item = document.createElement("div");

    item.className =
        author === "AI"
            ? "message ai"
            : "message user";

    item.innerHTML = `
        <strong>${escapeHtml(author)}</strong>
        <div>${escapeHtml(text)}</div>
    `;

    messages.appendChild(item);

    messages.scrollTop =
        messages.scrollHeight;
}

function speak(text) {
    if (!("speechSynthesis" in window)) {
        return;
    }

    window.speechSynthesis.cancel();

    const utterance =
        new SpeechSynthesisUtterance(text);

    utterance.lang = "ru-RU";
    utterance.rate = 1;
    utterance.pitch = 1;

    window.speechSynthesis.speak(
        utterance
    );
}

async function sendChat(message) {
    if (!message.trim()) return;

    addMessage("Вы", message);

    setStatus("AI думает...");

    try {
        const data = await api(
            "/api/chat",
            {
                method: "POST",
                body: JSON.stringify({
                    message,
                    latitude:
                        state.lastLocation?.lat ?? null,
                    longitude:
                        state.lastLocation?.lon ?? null
                })
            }
        );

        const answer =
            data.answer ||
            data.message ||
            "Не удалось получить ответ.";

        addMessage("AI", answer);

        speak(answer);

        if (data.route_to) {
            await routeFromUserTo(
                data.route_to
            );
        }

        setStatus("Готово.");
    } catch (error) {
        addMessage(
            "AI",
            "Ошибка: " + error.message
        );

        setStatus(
            "Произошла ошибка."
        );
    }
}

async function loginOrRegister(mode) {
    const email =
        $("email").value.trim();

    const password =
        $("password").value;

    if (!email || !password) {
        setStatus(
            "Введите email и пароль."
        );

        return;
    }

    try {
        const data = await api(
            mode === "login"
                ? "/api/login"
                : "/api/register",
            {
                method: "POST",
                body: JSON.stringify({
                    email,
                    password
                })
            }
        );

        state.token =
            data.access_token;

        localStorage.setItem(
            "route_ai_token",
            state.token
        );

        showAuth(false);

        setStatus(
            "Вы вошли в аккаунт."
        );

        locateUser();
    } catch (error) {
        setStatus(
            error.message
        );
    }
}

function updateOrbVolume(volume) {
    const orb = $("orb");

    if (!orb) return;

    const level =
        Math.min(
            1,
            Math.max(0, volume)
        );

    const scale =
        1 + level * 0.55;

    orb.style.transform =
        `scale(${scale})`;

    orb.style.boxShadow =
        `0 0 ${25 + level * 45}px ` +
        `rgba(80, 170, 255, ${0.35 + level * 0.6})`;
}

function stopVolumeAnimation() {
    if (state.animationFrame) {
        cancelAnimationFrame(
            state.animationFrame
        );

        state.animationFrame = null;
    }

    updateOrbVolume(0);
}

function monitorVolume() {
    if (!state.analyser) return;

    const buffer =
        new Uint8Array(
            state.analyser.fftSize
        );

    state.analyser.getByteTimeDomainData(
        buffer
    );

    let sum = 0;

    for (let i = 0; i < buffer.length; i++) {
        const value =
            (buffer[i] - 128) / 128;

        sum += value * value;
    }

    const rms =
        Math.sqrt(
            sum / buffer.length
        );

    const volume =
        Math.min(
            1,
            rms * 5
        );

    updateOrbVolume(volume);

    if (state.recording) {
        if (volume < 0.025) {
            if (!state.silenceTimer) {
                state.silenceTimer =
                    setTimeout(() => {
                        if (state.recording) {
                            stopRecording();
                        }
                    }, 1700);
            }
        } else if (state.silenceTimer) {
            clearTimeout(
                state.silenceTimer
            );

            state.silenceTimer = null;
        }
    }

    state.animationFrame =
        requestAnimationFrame(
            monitorVolume
        );
}

async function startRecording() {
    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
    ) {
        setStatus(
            "Браузер не поддерживает микрофон."
        );

        return;
    }

    try {
        state.stream =
            await navigator.mediaDevices.getUserMedia(
                {
                    audio: true
                }
            );

        state.audioChunks = [];

        state.mediaRecorder =
            new MediaRecorder(
                state.stream
            );

        state.audioContext =
            new (
                window.AudioContext ||
                window.webkitAudioContext
            )();

        const source =
            state.audioContext
                .createMediaStreamSource(
                    state.stream
                );

        state.analyser =
            state.audioContext
                .createAnalyser();

        state.analyser.fftSize =
            512;

        source.connect(
            state.analyser
        );

        state.mediaRecorder.ondataavailable =
            (event) => {
                if (event.data.size > 0) {
                    state.audioChunks.push(
                        event.data
                    );
                }
            };

        state.mediaRecorder.onstop =
            async () => {
                const blob =
                    new Blob(
                        state.audioChunks,
                        {
                            type:
                                state.mediaRecorder
                                    .mimeType ||
                                "audio/webm"
                        }
                    );

                cleanupRecording();

                await sendAudio(blob);
            };

        state.recording = true;

        state.mediaRecorder.start();

        $("orb")?.classList.add(
            "recording"
        );

        setStatus(
            "Слушаю... Говорите."
        );

        monitorVolume();
    } catch (error) {
        cleanupRecording();

        setStatus(
            "Не удалось включить микрофон: " +
            error.message
        );
    }
}

function stopRecording() {
    if (!state.recording) return;

    state.recording = false;

    if (
        state.mediaRecorder &&
        state.mediaRecorder.state !==
            "inactive"
    ) {
        state.mediaRecorder.stop();
    } else {
        cleanupRecording();
    }

    setStatus(
        "Обрабатываю голос..."
    );
}

function cleanupRecording() {
    if (state.silenceTimer) {
        clearTimeout(
            state.silenceTimer
        );

        state.silenceTimer = null;
    }

    stopVolumeAnimation();

    $("orb")?.classList.remove(
        "recording"
    );

    if (state.stream) {
        state.stream
            .getTracks()
            .forEach(
                (track) =>
                    track.stop()
            );
    }

    if (state.audioContext) {
        state.audioContext
            .close()
            .catch(() => {});
    }

    state.stream = null;
    state.audioContext = null;
    state.analyser = null;
    state.mediaRecorder = null;
}

async function sendAudio(blob) {
    try {
        const formData =
            new FormData();

        formData.append(
            "audio",
            blob,
            "voice.webm"
        );

        const data =
            await api(
                "/api/transcribe",
                {
                    method: "POST",
                    body: formData
                }
            );

        const text =
            data.text?.trim();

        if (!text) {
            setStatus(
                "Не удалось распознать речь."
            );

            return;
        }

        addMessage(
            "Вы",
            text
        );

        await sendChat(text);
    } catch (error) {
        addMessage(
            "AI",
            "Ошибка распознавания: " +
            error.message
        );

        setStatus(
            "Ошибка обработки голоса."
        );
    }
}

function setupEvents() {
    $("loginButton")
        ?.addEventListener(
            "click",
            () => {
                loginOrRegister(
                    "login"
                );
            }
        );

    $("registerButton")
        ?.addEventListener(
            "click",
            () => {
                loginOrRegister(
                    "register"
                );
            }
        );

    $("locateButton")
        ?.addEventListener(
            "click",
            () => {
                locateUser();
            }
        );

    $("sendButton")
        ?.addEventListener(
            "click",
            () => {
                const input =
                    $("messageInput");

                if (!input) return;

                const text =
                    input.value.trim();

                input.value = "";

                sendChat(text);
            }
        );

    $("messageInput")
        ?.addEventListener(
            "keydown",
            (event) => {
                if (
                    event.key ===
                    "Enter"
                ) {
                    event.preventDefault();

                    $("sendButton")
                        ?.click();
                }
            }
        );

    $("orb")
        ?.addEventListener(
            "click",
            () => {
                if (state.recording) {
                    stopRecording();
                } else {
                    startRecording();
                }
            }
        );

    $("logoutButton")
        ?.addEventListener(
            "click",
            () => {
                state.token = "";

                localStorage.removeItem(
                    "route_ai_token"
                );

                showAuth(true);

                setStatus(
                    "Вы вышли из аккаунта."
                );
            }
        );
}

document.addEventListener(
    "DOMContentLoaded",
    () => {
        initMap();

        setupEvents();

        if (state.token) {
            showAuth(false);
            locateUser();
        } else {
            showAuth(true);
        }
    }
);
