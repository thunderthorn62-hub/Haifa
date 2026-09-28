const state = {
    token: localStorage.getItem("route_ai_token") || "",
    username: localStorage.getItem("route_ai_username") || "",

    map: null,
    userMarker: null,
    accuracyCircle: null,
    routeLayer: null,

    recording: false,
    mediaRecorder: null,
    audioChunks: [],
    stream: null,

    audioContext: null,
    analyser: null,
    animationFrame: null,
    silenceTimer: null,

    location: null
};

const $ = (id) => document.getElementById(id);


/* =========================
   UI
========================= */

function showElement(id) {
    const el = $(id);
    if (el) el.classList.remove("hidden");
}

function hideElement(id) {
    const el = $(id);
    if (el) el.classList.add("hidden");
}

function setStatus(text) {
    const el = $("statusText");

    if (el) {
        el.textContent = text;
    }
}

function setAuthError(text) {
    const el = $("authError");

    if (el) {
        el.textContent = text || "";
    }
}

function setTranscript(text) {
    const el = $("transcript");

    if (el) {
        el.textContent = text || "";
    }
}

function showLoginForm() {
    hideElement("registerForm");
    showElement("loginForm");
    setAuthError("");
}

function showRegisterForm() {
    hideElement("loginForm");
    showElement("registerForm");
    setAuthError("");
}

function showApp() {
    hideElement("authScreen");
    showElement("appScreen");

    const usernameLabel = $("usernameLabel");

    if (usernameLabel) {
        usernameLabel.textContent =
            state.username || "";
    }

    setTimeout(() => {
        if (state.map) {
            state.map.invalidateSize();
        }
    }, 200);
}

function showAuth() {
    showElement("authScreen");
    hideElement("appScreen");
}


/* =========================
   API
========================= */

async function api(url, options = {}) {
    const headers = {
        ...(options.headers || {})
    };

    if (state.token) {
        headers.Authorization =
            `Bearer ${state.token}`;
    }

    if (
        options.body &&
        !(options.body instanceof FormData)
    ) {
        headers["Content-Type"] =
            "application/json";
    }

    const response = await fetch(
        url,
        {
            ...options,
            headers
        }
    );

    let data = {};

    try {
        data = await response.json();
    } catch (_) {
        data = {};
    }

    if (!response.ok) {
        throw new Error(
            data.detail ||
            `Ошибка сервера: ${response.status}`
        );
    }

    return data;
}


/* =========================
   AUTH
========================= */

async function register() {
    const username =
        $("registerUsername")?.value.trim();

    const email =
        $("registerEmail")?.value.trim();

    const password =
        $("registerPassword")?.value;

    if (!username || !email || !password) {
        setAuthError(
            "Заполните все поля."
        );
        return;
    }

    if (password.length < 6) {
        setAuthError(
            "Пароль должен содержать минимум 6 символов."
        );
        return;
    }

    setAuthError("");
    setStatus("Создаю аккаунт...");

    try {
        const data = await api(
            "/api/register",
            {
                method: "POST",
                body: JSON.stringify({
                    username,
                    email,
                    password
                })
            }
        );

        state.token = data.token;
        state.username =
            data.username || username;

        localStorage.setItem(
            "route_ai_token",
            state.token
        );

        localStorage.setItem(
            "route_ai_username",
            state.username
        );

        showApp();

        setStatus(
            "Аккаунт создан. Определяю ваше местоположение..."
        );

        await locateUser();

    } catch (error) {
        console.error(
            "REGISTER ERROR:",
            error
        );

        setAuthError(
            error.message
        );

        setStatus(
            "Ошибка регистрации."
        );
    }
}

async function login() {
    const email =
        $("loginEmail")?.value.trim();

    const password =
        $("loginPassword")?.value;

    if (!email || !password) {
        setAuthError(
            "Введите email и пароль."
        );
        return;
    }

    setAuthError("");
    setStatus("Выполняю вход...");

    try {
        const data = await api(
            "/api/login",
            {
                method: "POST",
                body: JSON.stringify({
                    email,
                    password
                })
            }
        );

        state.token = data.token;
        state.username =
            data.username || "";

        localStorage.setItem(
            "route_ai_token",
            state.token
        );

        localStorage.setItem(
            "route_ai_username",
            state.username
        );

        showApp();

        setStatus(
            "Вход выполнен. Определяю местоположение..."
        );

        await locateUser();

    } catch (error) {
        console.error(
            "LOGIN ERROR:",
            error
        );

        setAuthError(
            error.message
        );

        setStatus(
            "Ошибка входа."
        );
    }
}


/* =========================
   MAP
========================= */

function initMap() {
    const mapElement =
        $("map");

    if (!mapElement) {
        console.error(
            "Элемент #map не найден"
        );
        return;
    }

    state.map = L.map(
        "map",
        {
            zoomControl: true
        }
    ).setView(
        [32.0853, 34.7818],
        11
    );

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution:
                "&copy; OpenStreetMap contributors"
        }
    ).addTo(state.map);
}


/* =========================
   LOCATION
========================= */

function locateUser() {
    return new Promise(
        (resolve, reject) => {

            if (!navigator.geolocation) {
                setStatus(
                    "Геолокация не поддерживается."
                );

                reject(
                    new Error(
                        "Геолокация не поддерживается"
                    )
                );

                return;
            }

            setStatus(
                "Определяю ваше местоположение..."
            );

            navigator.geolocation.getCurrentPosition(
                (position) => {

                    const lat =
                        position.coords.latitude;

                    const lon =
                        position.coords.longitude;

                    const accuracy =
                        position.coords.accuracy;

                    state.location = {
                        latitude: lat,
                        longitude: lon
                    };

                    if (!state.userMarker) {

                        state.userMarker =
                            L.marker(
                                [lat, lon]
                            ).addTo(
                                state.map
                            );

                        state.userMarker.bindPopup(
                            "Вы здесь"
                        );

                    } else {

                        state.userMarker.setLatLng(
                            [lat, lon]
                        );
                    }

                    if (!state.accuracyCircle) {

                        state.accuracyCircle =
                            L.circle(
                                [lat, lon],
                                {
                                    radius: accuracy,
                                    weight: 1,
                                    fillOpacity: 0.08
                                }
                            ).addTo(
                                state.map
                            );

                    } else {

                        state.accuracyCircle.setLatLng(
                            [lat, lon]
                        );

                        state.accuracyCircle.setRadius(
                            accuracy
                        );
                    }

                    state.map.setView(
                        [lat, lon],
                        14
                    );

                    setStatus(
                        "Местоположение найдено."
                    );

                    resolve(
                        state.location
                    );
                },

                (error) => {

                    console.error(
                        "GEOLOCATION:",
                        error
                    );

                    let message =
                        "Не удалось определить местоположение.";

                    if (
                        error.code ===
                        error.PERMISSION_DENIED
                    ) {
                        message =
                            "Разрешите доступ к геолокации в браузере.";
                    }

                    setStatus(
                        message
                    );

                    reject(
                        new Error(message)
                    );
                },

                {
                    enableHighAccuracy: true,
                    timeout: 15000,
                    maximumAge: 5000
                }
            );
        }
    );
}


/* =========================
   ROUTE
========================= */

function clearRoute() {
    if (state.routeLayer) {
        state.map.removeLayer(
            state.routeLayer
        );

        state.routeLayer = null;
    }
}

function drawRoute(route) {
    clearRoute();

    if (
        !route ||
        !route.geometry
    ) {
        return;
    }

    state.routeLayer =
        L.geoJSON(
            route.geometry,
            {
                style: {
                    weight: 6,
                    opacity: 0.9
                }
            }
        ).addTo(
            state.map
        );

    const bounds =
        state.routeLayer.getBounds();

    if (bounds.isValid()) {
        state.map.fitBounds(
            bounds,
            {
                padding: [40, 40]
            }
        );
    }
}

function formatDistance(meters) {
    if (meters < 1000) {
        return (
            Math.round(meters) +
            " м"
        );
    }

    return (
        (meters / 1000).toFixed(1) +
        " км"
    );
}

function formatDuration(seconds) {
    const minutes =
        Math.round(
            seconds / 60
        );

    if (minutes < 60) {
        return (
            minutes +
            " мин"
        );
    }

    const hours =
        Math.floor(
            minutes / 60
        );

    const remaining =
        minutes % 60;

    if (remaining === 0) {
        return (
            hours +
            " ч"
        );
    }

    return (
        hours +
        " ч " +
        remaining +
        " мин"
    );
}

function showRouteInfo(data) {
    const panel =
        $("infoPanel");

    if (!panel) {
        return;
    }

    const route =
        data.route;

    const destination =
        data.destination;

    if (!route) {
        return;
    }

    panel.innerHTML = `
        <div>
            <strong>Маршрут построен</strong>
        </div>

        <div>
            До:
            ${escapeHtml(
                destination?.display_name ||
                "назначения"
            )}
        </div>

        <div>
            Расстояние:
            ${formatDistance(
                route.distance_m
            )}
        </div>

        <div>
            Время:
            ${formatDuration(
                route.duration_s
            )}
        </div>
    `;

    panel.classList.remove(
        "hidden"
    );
}


/* =========================
   ASSISTANT
========================= */

async function sendToAssistant(text) {
    text = text?.trim();

    if (!text) {
        return;
    }

    try {
        setStatus("Думаю...");

        const data = await api(
            "/api/assistant",
            {
                method: "POST",
                body: JSON.stringify({
                    text: text,
                    latitude: state.location?.latitude ?? null,
                    longitude: state.location?.longitude ?? null
                })
            }
        );

        // =========================================
        // ОБЫЧНЫЙ РАЗГОВОР
        // =========================================

        if (data.type === "chat") {
            const reply =
                data.text ||
                "Не удалось получить ответ.";

            setTranscript(reply);
            setStatus("Готово");

            speak(reply);

            return;
        }

        // =========================================
        // НАВИГАЦИЯ
        // =========================================

        if (data.type === "route") {

            if (data.route) {
                drawRoute(data.route);
            }

            const reply =
                data.text ||
                "Маршрут построен.";

            setTranscript(reply);
            setStatus("Маршрут построен");

            showRouteInfo(data);

            speak(reply);

            return;
        }

        // =========================================
        // ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЯ
        // =========================================

        if (data.type === "image") {

            const reply =
                data.text ||
                "Готово! Я создал изображение.";

            setTranscript(reply);
            setStatus("Изображение создано");

            if (data.image) {
                showGeneratedImage(data.image);
            }

            speak(reply);

            return;
        }

        // =========================================
        // НЕИЗВЕСТНЫЙ ТИП ОТВЕТА
        // =========================================

        const reply =
            data.text ||
            data.message ||
            "Я получил ответ, но не смог его обработать.";

        setTranscript(reply);
        setStatus("Готово");

        speak(reply);

    } catch (error) {

        console.error(
            "ASSISTANT ERROR:",
            error
        );

        setStatus("Ошибка");

        setTranscript(
            error.message ||
            "Произошла ошибка."
        );
    }
}

/* =========================
   SPEECH
========================= */

function speak(text) {
    if (
        !text ||
        !("speechSynthesis" in window)
    ) {
        return;
    }

    window.speechSynthesis.cancel();

    const utterance =
        new SpeechSynthesisUtterance(
            text
        );

    utterance.lang =
        "ru-RU";

    utterance.rate =
        1;

    utterance.pitch =
        1;

    window.speechSynthesis.speak(
        utterance
    );
}


/* =========================
   VOICE ORB
========================= */

function updateOrb(volume) {
    const orb =
        $("voiceOrb");

    if (!orb) {
        return;
    }

    const level =
        Math.max(
            0,
            Math.min(
                1,
                volume
            )
        );

    const scale =
        1 +
        level * 0.35;

    orb.style.transform =
        `scale(${scale})`;

    const glow =
        20 +
        level * 50;

    orb.style.filter =
        `drop-shadow(0 0 ${glow}px rgba(80,170,255,0.8))`;
}

function stopOrbAnimation() {
    if (state.animationFrame) {

        cancelAnimationFrame(
            state.animationFrame
        );

        state.animationFrame =
            null;
    }

    updateOrb(0);
}

function monitorVolume() {
    if (!state.analyser) {
        return;
    }

    const buffer =
        new Uint8Array(
            state.analyser.fftSize
        );

    state.analyser.getByteTimeDomainData(
        buffer
    );

    let sum = 0;

    for (
        let i = 0;
        i < buffer.length;
        i++
    ) {

        const value =
            (buffer[i] - 128) /
            128;

        sum +=
            value * value;
    }

    const rms =
        Math.sqrt(
            sum /
            buffer.length
        );

    const volume =
        Math.min(
            1,
            rms * 5
        );

    updateOrb(
        volume
    );

    if (state.recording) {

        if (volume < 0.025) {

            if (!state.silenceTimer) {

                state.silenceTimer =
                    setTimeout(
                        () => {

                            if (
                                state.recording
                            ) {
                                stopRecording();
                            }

                        },
                        1700
                    );
            }

        } else {

            if (state.silenceTimer) {

                clearTimeout(
                    state.silenceTimer
                );

                state.silenceTimer =
                    null;
            }
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
            "Микрофон не поддерживается."
        );

        return;
    }

    try {

        state.stream =
            await navigator.mediaDevices
                .getUserMedia({
                    audio: true
                });

        state.audioChunks = [];

        let mimeType =
            "audio/webm";

        if (
            MediaRecorder.isTypeSupported(
                "audio/webm;codecs=opus"
            )
        ) {
            mimeType =
                "audio/webm;codecs=opus";
        }

        state.mediaRecorder =
            new MediaRecorder(
                state.stream,
                {
                    mimeType
                }
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

                if (
                    event.data &&
                    event.data.size > 0
                ) {

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
                                    ?.mimeType ||
                                "audio/webm"
                        }
                    );

                cleanupRecording();

                if (
                    blob.size > 0
                ) {
                    await sendAudio(
                        blob
                    );
                }
            };

        state.recording =
            true;

        state.mediaRecorder.start();

        $("voiceOrb")
            ?.classList.add(
                "recording"
            );

        setStatus(
            "Слушаю... Говорите."
        );

        setTranscript("");

        monitorVolume();

    } catch (error) {

        console.error(
            "MICROPHONE ERROR:",
            error
        );

        cleanupRecording();

        setStatus(
            "Не удалось включить микрофон: " +
            error.message
        );
    }
}

function stopRecording() {

    if (!state.recording) {
        return;
    }

    state.recording =
        false;

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
        "Распознаю речь..."
    );
}

function cleanupRecording() {
    if (state.silenceTimer) {
        clearTimeout(state.silenceTimer);
        state.silenceTimer = null;
    }

    stopOrbAnimation();

    $("voiceOrb")?.classList.remove("recording");

    if (state.stream) {
        state.stream
            .getTracks()
            .forEach(track => track.stop());
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


/* =========================
   SEND AUDIO
========================= */

async function sendAudio(blob) {
    try {
        const formData = new FormData();

        formData.append(
            "audio",
            blob,
            "recording.webm"
        );

        const data = await api(
            "/api/transcribe",
            {
                method: "POST",
                body: formData
            }
        );

        const text = data.text?.trim();

        if (!text) {
            setStatus(
                "Не удалось распознать речь."
            );

            return;
        }

        setTranscript(text);

        await sendToAssistant(text);

    } catch (error) {
        console.error(
            "TRANSCRIBE ERROR:",
            error
        );

        setStatus(
            "Ошибка распознавания речи."
        );

        setTranscript(
            error.message
        );
    }
}


/* =========================
   EVENTS
========================= */

function setupEvents() {

    $("showRegister")
        ?.addEventListener(
            "click",
            () => {
                showRegisterForm();
            }
        );

    $("showLogin")
        ?.addEventListener(
            "click",
            () => {
                showLoginForm();
            }
        );

    $("loginButton")
        ?.addEventListener(
            "click",
            () => {
                login();
            }
        );

    $("registerButton")
        ?.addEventListener(
            "click",
            () => {
                register();
            }
        );

    $("voiceOrb")
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

    $("loginPassword")
        ?.addEventListener(
            "keydown",
            (event) => {

                if (
                    event.key === "Enter"
                ) {
                    login();
                }

            }
        );

    $("registerPassword")
        ?.addEventListener(
            "keydown",
            (event) => {

                if (
                    event.key === "Enter"
                ) {
                    register();
                }

            }
        );
}


/* =========================
   HTML ESCAPE
========================= */

function escapeHtml(value) {

    return String(value)
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );
}


/* =========================
   START
========================= */

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        initMap();

        setupEvents();

        if (state.token) {

            try {

                const me = await api(
                    "/api/me"
                );

                state.username =
                    me.username ||
                    state.username;

                localStorage.setItem(
                    "route_ai_username",
                    state.username
                );

                showApp();

                setStatus(
                    "Определяю ваше местоположение..."
                );

                await locateUser();

            } catch (error) {

                console.warn(
                    "Saved session invalid:",
                    error
                );

                state.token = "";
                state.username = "";

                localStorage.removeItem(
                    "route_ai_token"
                );

                localStorage.removeItem(
                    "route_ai_username"
                );

                showAuth();

                showLoginForm();
            }

        } else {

            showAuth();

            showLoginForm();
        }
    }
);

function showGeneratedImage(imageData) {
    if (!imageData) {
        return;
    }

    const oldImage =
        document.getElementById("generatedImage");

    if (oldImage) {
        oldImage.remove();
    }

    const image = document.createElement("img");

    image.id = "generatedImage";
    image.src = imageData;
    image.alt = "Сгенерированное изображение";

    image.style.width = "100%";
    image.style.maxWidth = "700px";
    image.style.borderRadius = "20px";
    image.style.display = "block";
    image.style.margin = "20px auto";
    image.style.boxShadow =
        "0 10px 40px rgba(0,0,0,0.25)";

    const appScreen =
        document.getElementById("appScreen");

    if (appScreen) {
        appScreen.appendChild(image);
    }
}
