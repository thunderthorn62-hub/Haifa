# Route AI

Голосовой помощник для маршрутов на FastAPI + MongoDB + OpenStreetMap + OSRM + Groq.

## Render

Build command:

pip install -r requirements.txt

Start command:

uvicorn main:app --host 0.0.0.0 --port $PORT

## Environment Variables

MONGODB_URI=...
SECRET_KEY=...
GROQ_API_KEY=...
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...

Cloudflare variables пока зарезервированы для следующего этапа генерации и анализа изображений.

## Первый этап

- регистрация и вход;
- MongoDB;
- карта OpenStreetMap;
- определение текущего местоположения;
- голосовой шар;
- автоматическая остановка после тишины;
- ручная остановка повторным нажатием;
- Groq Whisper speech-to-text;
- Groq command parsing;
- Nominatim geocoding;
- OSRM driving route;
- сохранение маршрутов и сообщений в MongoDB;
- озвучивание ответа через браузер SpeechSynthesis.

## Важно

Для OpenStreetMap/Nominatim нужно соблюдать их политики использования и не превращать публичные сервисы в высоконагруженный массовый геокодер.
