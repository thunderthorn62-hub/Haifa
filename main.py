import os
import json
import hashlib
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from fastapi import FastAPI, UploadFile, File, HTTPException, Header
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pymongo import MongoClient
from jose import jwt

MONGODB_URI = os.getenv("MONGODB_URI")
SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-render")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
CLOUDFLARE_ACCOUNT_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID")
CLOUDFLARE_API_TOKEN = os.getenv("CLOUDFLARE_API_TOKEN")

if not MONGODB_URI:
    raise RuntimeError("MONGODB_URI is not configured")

app = FastAPI(title="AI Route Assistant")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

mongo = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=10000)
db = mongo["ai_route_assistant"]
users = db["users"]
routes = db["routes"]
messages = db["messages"]

users.create_index("email", unique=True)
users.create_index("username", unique=True)


class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    email: str = Field(min_length=5, max_length=120)
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    email: str
    password: str


class AssistantRequest(BaseModel):
    text: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None


def hash_password(password: str, salt: Optional[bytes] = None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 180_000)
    return salt.hex() + "$" + digest.hex()


def verify_password(password: str, stored: str):
    try:
        salt_hex, digest_hex = stored.split("$", 1)
        salt = bytes.fromhex(salt_hex)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 180_000)
        return secrets.compare_digest(digest.hex(), digest_hex)
    except Exception:
        return False


def make_token(user_id: str):
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=30),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def get_user(authorization: Optional[str]):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Требуется авторизация")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        user = users.find_one({"_id": payload["sub"]})
        if not user:
            raise HTTPException(401, "Пользователь не найден")
        return user
    except Exception:
        raise HTTPException(401, "Недействительная сессия")


@app.get("/")
async def index():
    return FileResponse("index.html")


@app.get("/app.js")
async def js():
    return FileResponse("app.js", media_type="application/javascript")


@app.get("/style.css")
async def css():
    return FileResponse("style.css", media_type="text/css")


@app.post("/api/register")
async def register(data: RegisterRequest):
    username = data.username.strip()
    email = data.email.strip().lower()

    if users.find_one({"email": email}):
        raise HTTPException(409, "Этот email уже зарегистрирован")
    if users.find_one({"username": username}):
        raise HTTPException(409, "Это имя пользователя уже занято")

    user_id = secrets.token_hex(16)
    users.insert_one({
        "_id": user_id,
        "username": username,
        "email": email,
        "password_hash": hash_password(data.password),
        "created_at": datetime.now(timezone.utc),
    })

    return {
        "token": make_token(user_id),
        "username": username,
    }


@app.post("/api/login")
async def login(data: LoginRequest):
    email = data.email.strip().lower()
    user = users.find_one({"email": email})

    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(401, "Неверный email или пароль")

    return {
        "token": make_token(user["_id"]),
        "username": user["username"],
    }


async def groq_chat(system: str, user_text: str):
    if not GROQ_API_KEY:
        raise HTTPException(500, "GROQ_API_KEY не настроен")

    body = {
        "model": "llama-3.3-70b-versatile",
        "temperature": 0.15,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_text},
        ],
    }

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers,
            json=body,
        )

    if response.status_code >= 400:
        raise HTTPException(502, f"Groq error: {response.text[:500]}")

    data = response.json()
    return data["choices"][0]["message"]["content"]


async def geocode(place: str):
    headers = {
        "User-Agent": "AI-Route-Assistant/1.0 (personal project)"
    }
    params = {
        "q": place,
        "format": "jsonv2",
        "limit": 1,
    }

    async with httpx.AsyncClient(timeout=20, headers=headers) as client:
        response = await client.get(
            "https://nominatim.openstreetmap.org/search",
            params=params,
        )

    if response.status_code >= 400:
        raise HTTPException(502, "Ошибка геокодирования")

    data = response.json()
    if not data:
        raise HTTPException(404, f"Место не найдено: {place}")

    return {
        "lat": float(data[0]["lat"]),
        "lon": float(data[0]["lon"]),
        "display_name": data[0]["display_name"],
    }


async def build_route(lat1: float, lon1: float, lat2: float, lon2: float):
    coords = f"{lon1},{lat1};{lon2},{lat2}"
    url = f"https://router.project-osrm.org/route/v1/driving/{coords}"

    params = {
        "overview": "full",
        "geometries": "geojson",
        "steps": "true",
        "alternatives": "false",
    }

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.get(url, params=params)

    if response.status_code >= 400:
        raise HTTPException(502, "Ошибка маршрутизатора OSRM")

    data = response.json()

    if data.get("code") != "Ok" or not data.get("routes"):
        raise HTTPException(404, "Маршрут не найден")

    route = data["routes"][0]

    return {
        "distance_m": route["distance"],
        "duration_s": route["duration"],
        "geometry": route["geometry"],
        "steps": [
            {
                "name": step.get("name", ""),
                "distance_m": step.get("distance", 0),
                "duration_s": step.get("duration", 0),
                "type": step.get("maneuver", {}).get("type"),
                "modifier": step.get("maneuver", {}).get("modifier"),
            }
            for leg in route.get("legs", [])
            for step in leg.get("steps", [])
        ],
    }


async def parse_command(text: str):
    prompt = """
Ты диспетчер AI-навигации. Определи намерение пользователя.
Верни ТОЛЬКО корректный JSON без markdown.

Формат:
{"intent":"route","destination":"Москва","reply":"Короткая фраза на языке пользователя"}

Возможные intent:
- route: пользователь просит построить маршрут до места
- chat: обычный вопрос или разговор

Если destination отсутствует, используй null.
Не придумывай координаты.
"""
    raw = await groq_chat(prompt, text)

    try:
        start = raw.find("{")
        end = raw.rfind("}") + 1
        return json.loads(raw[start:end])
    except Exception:
        return {"intent": "chat", "destination": None, "reply": raw}


@app.post("/api/assistant")
async def assistant(data: AssistantRequest, authorization: Optional[str] = Header(None)):
    user = get_user(authorization)

    command = await parse_command(data.text)

    if command.get("intent") == "route":
        if data.latitude is None or data.longitude is None:
            raise HTTPException(400, "Нужно разрешение на геолокацию")

        destination = command.get("destination")
        if not destination:
            raise HTTPException(400, "Не удалось определить пункт назначения")

        target = await geocode(destination)

        route = await build_route(
            data.latitude,
            data.longitude,
            target["lat"],
            target["lon"],
        )

        routes.insert_one({
            "user_id": user["_id"],
            "origin": {
                "lat": data.latitude,
                "lon": data.longitude,
            },
            "destination": {
                "query": destination,
                "lat": target["lat"],
                "lon": target["lon"],
                "display_name": target["display_name"],
            },
            "distance_m": route["distance_m"],
            "duration_s": route["duration_s"],
            "geometry": route["geometry"],
            "created_at": datetime.now(timezone.utc),
        })

        km = route["distance_m"] / 1000
        minutes = round(route["duration_s"] / 60)

        reply = (
            f"Маршрут до {target['display_name']} построен. "
            f"Расстояние примерно {km:.1f} км, время в пути около {minutes} минут."
        )

        messages.insert_one({
            "user_id": user["_id"],
            "type": "route",
            "user_text": data.text,
            "assistant_text": reply,
            "created_at": datetime.now(timezone.utc),
        })

        return {
            "type": "route",
            "text": reply,
            "route": route,
            "destination": target,
        }

    reply = await groq_chat(
        "Ты дружелюбный голосовой помощник по навигации. "
        "Отвечай кратко, понятно и на языке пользователя.",
        data.text,
    )

    messages.insert_one({
        "user_id": user["_id"],
        "type": "chat",
        "user_text": data.text,
        "assistant_text": reply,
        "created_at": datetime.now(timezone.utc),
    })

    return {"type": "chat", "text": reply}


@app.post("/api/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    authorization: Optional[str] = Header(None),
):
    get_user(authorization)

    if not GROQ_API_KEY:
        raise HTTPException(500, "GROQ_API_KEY не настроен")

    audio_bytes = await audio.read()

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
    }

    files = {
        "file": (
            audio.filename or "recording.webm",
            audio_bytes,
            audio.content_type or "audio/webm",
        )
    }

    data = {
        "model": "whisper-large-v3-turbo",
        "response_format": "json",
    }

    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers=headers,
            files=files,
            data=data,
        )

    if response.status_code >= 400:
        raise HTTPException(502, f"Ошибка распознавания речи: {response.text[:500]}")

    result = response.json()
    return {"text": result.get("text", "").strip()}


@app.get("/api/me")
async def me(authorization: Optional[str] = Header(None)):
    user = get_user(authorization)
    return {"username": user["username"], "email": user["email"]}


@app.get("/health")
async def health():
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
