#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>

// ── Configuración ─────────────────────────────────────────────────────────────
const char* WIFI_SSID     = "NOMBRE_DE_TU_WIFI";
const char* WIFI_PASSWORD = "CONTRASEÑA_WIFI";

const String HIGHLIGHT_URL = "https://tu-partido.vercel.app/api/highlight?cancha_id=4b44bd86-dfdf-4134-b8e4-b04a7b4900c7";

const int PIN_BOTON = D2;   // Pin donde conectás el botón (D2 = GPIO4)
const int PIN_LED   = D4;   // LED integrado en la placa (indica feedback)

// ── Variables ─────────────────────────────────────────────────────────────────
bool botonPresionadoAntes = false;
unsigned long ultimoClick = 0;
const int DEBOUNCE_MS = 500; // evita doble disparo por vibración del botón

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BOTON, INPUT_PULLUP); // botón conectado entre D2 y GND
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, HIGH);      // LED apagado (activo LOW en NodeMCU)

  conectarWifi();
}

void conectarWifi() {
  Serial.print("Conectando a WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    digitalWrite(PIN_LED, !digitalRead(PIN_LED)); // parpadea mientras conecta
  }
  Serial.println("\nConectado! IP: " + WiFi.localIP().toString());
  digitalWrite(PIN_LED, HIGH); // apaga LED al conectar
}

// ── Loop principal ────────────────────────────────────────────────────────────
void loop() {
  // Reconectar si se cae el WiFi
  if (WiFi.status() != WL_CONNECTED) {
    conectarWifi();
  }

  bool botonPresionado = (digitalRead(PIN_BOTON) == LOW); // LOW = presionado (INPUT_PULLUP)

  if (botonPresionado && !botonPresionadoAntes) {
    unsigned long ahora = millis();
    if (ahora - ultimoClick > DEBOUNCE_MS) {
      ultimoClick = ahora;
      marcarHighlight();
    }
  }

  botonPresionadoAntes = botonPresionado;
  delay(10);
}

// ── Marcar highlight ──────────────────────────────────────────────────────────
void marcarHighlight() {
  Serial.println("Botón presionado → marcando highlight...");
  parpadeaLED(1); // parpadeo rápido = enviando

  WiFiClientSecure client;
  client.setInsecure(); // acepta HTTPS sin verificar certificado (OK para este uso)

  HTTPClient http;
  http.begin(client, HIGHLIGHT_URL);
  http.setTimeout(5000);

  int httpCode = http.GET();

  if (httpCode == 200) {
    Serial.println("✓ Highlight registrado OK");
    parpadeaLED(3); // 3 parpadeos = éxito
  } else {
    Serial.println("✗ Error HTTP: " + String(httpCode));
    parpadeaLED(6); // 6 parpadeos rápidos = error
  }

  http.end();
}

// ── Feedback visual con el LED ────────────────────────────────────────────────
void parpadeaLED(int veces) {
  for (int i = 0; i < veces; i++) {
    digitalWrite(PIN_LED, LOW);  // encender
    delay(100);
    digitalWrite(PIN_LED, HIGH); // apagar
    delay(100);
  }
}
