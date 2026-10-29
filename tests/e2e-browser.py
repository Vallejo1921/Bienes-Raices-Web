#!/usr/bin/env python3
"""E2E real de ADAHRA en Firefox headless con un perfil temporal.

Comprueba:
  1. El estado vacío público y el editor local sin backend.
  2. El catálogo lleno: render, filtros, modal y favoritos.
  3. El editor: cargar JSON, validación, alta, edición, borrado, exportación
     e importación del archivo exportado.

No usa Firebase, no toca el perfil personal del navegador y no escribe en el
proyecto: todo el escenario lleno ocurre en una copia temporal.
"""

import base64
import json
import os
import re
import select
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAVORITES_KEY = "adahra-favoritos-v1"
SCREENSHOT_DIR = "/tmp/adahra-screenshots"


def log(message):
    print(message, flush=True)


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    log("PASS  " + message)


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def http_status(url):
    with urllib.request.urlopen(url, timeout=10) as response:
        return response.status, response.headers.get("content-type", "")


class WebSocket:
    """Cliente WebSocket mínimo para el endpoint WebDriver BiDi de Firefox."""

    def __init__(self, url, timeout=30):
        match = re.match(r"ws://([^:/]+):(\d+)(/.*)?$", url)
        if not match:
            raise RuntimeError("URL WebSocket inesperada")
        host, port, path = match.group(1), int(match.group(2)), match.group(3) or "/session"
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.settimeout(timeout)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(request.encode("ascii"))
        buffer = b""
        while b"\r\n\r\n" not in buffer:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("El WebSocket cerró durante el handshake")
            buffer += chunk
        head, self.buffer = buffer.split(b"\r\n\r\n", 1)
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise RuntimeError("Handshake WebSocket rechazado")
        self.next_id = 0
        self.events = []

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass

    def _recvn(self, size):
        while len(self.buffer) < size:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError("El WebSocket cerró")
            self.buffer += chunk
        data, self.buffer = self.buffer[:size], self.buffer[size:]
        return data

    def _send_frame(self, opcode, payload):
        header = bytearray([0x80 | opcode])
        length = len(payload)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header += struct.pack("!H", length)
        else:
            header.append(0x80 | 127)
            header += struct.pack("!Q", length)
        mask = os.urandom(4)
        header += mask
        masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        self.sock.sendall(bytes(header) + masked)

    def _recv_message(self):
        while True:
            first, second = self._recvn(2)
            opcode = first & 0x0F
            length = second & 0x7F
            if length == 126:
                length = struct.unpack("!H", self._recvn(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self._recvn(8))[0]
            mask = self._recvn(4) if second & 0x80 else None
            payload = self._recvn(length)
            if mask:
                payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
            if opcode == 8:
                raise RuntimeError("El WebSocket cerró la sesión")
            if opcode == 9:
                self._send_frame(10, payload)
                continue
            if opcode in (1, 2):
                return json.loads(payload.decode("utf-8"))

    def send(self, message):
        self._send_frame(1, json.dumps(message).encode("utf-8"))

    def pump(self, timeout=0.2):
        end = time.time() + timeout
        while time.time() < end:
            readable, _, _ = select.select([self.sock], [], [], max(0, end - time.time()))
            if not readable:
                return
            message = self._recv_message()
            if "method" in message:
                self.events.append(message)

    def command(self, method, params=None):
        self.next_id += 1
        message_id = self.next_id
        self.send({"id": message_id, "method": method, "params": params or {}})
        while True:
            message = self._recv_message()
            if "method" in message:
                self.events.append(message)
                continue
            if message.get("id") != message_id:
                continue
            if "error" in message:
                raise RuntimeError(f"{method} falló: {message['error']}")
            return message.get("result", {})

    def console_errors(self):
        errors = []
        for message in self.events:
            if message.get("method") != "log.entryAdded":
                continue
            entry = message.get("params", {}).get("entry", {})
            if entry.get("level") == "error":
                errors.append(entry.get("text", ""))
        return errors


class Browser:
    def __init__(self, timeout=45, prefers_reduced_motion=False):
        # Firefox Snap no puede leer /tmp: el perfil temporal vive en HOME,
        # nunca en el perfil personal, y se borra al terminar.
        self.profile = tempfile.mkdtemp(prefix="adahra-e2e-profile-", dir=os.path.expanduser("~"))
        self.port = free_port()
        with open(os.path.join(self.profile, "prefs.js"), "w", encoding="utf-8") as handle:
            handle.write('user_pref("marionette.port", %d);\n' % free_port())
            handle.write('user_pref("browser.shell.checkDefaultBrowser", false);\n')
            handle.write('user_pref("datareporting.policy.dataSubmissionEnabled", false);\n')
            handle.write('user_pref("toolkit.telemetry.enabled", false);\n')
            handle.write('user_pref("app.update.enabled", false);\n')
            handle.write('user_pref("browser.startup.homepage_override.mstone", "ignore");\n')
            handle.write('user_pref("browser.sessionstore.resume_from_crash", false);\n')
            handle.write('user_pref("network.cookie.sameSite.noneRequiresSecure", true);\n')
            if prefers_reduced_motion:
                handle.write('user_pref("ui.prefersReducedMotion", 1);\n')

        self.process = subprocess.Popen(
            [
                "firefox",
                "--headless",
                "--no-remote",
                "--profile",
                self.profile,
                "--remote-debugging-port",
                str(self.port),
                "about:blank",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            start_new_session=True,
        )
        self.ws = WebSocket(self._wait_for_bidi(timeout))
        self.ws.command("session.new", {"capabilities": {}})
        self.ws.command("session.subscribe", {"events": ["log.entryAdded"]})
        tree = self.ws.command("browsingContext.getTree", {})
        contexts = tree.get("contexts", [])
        if not contexts:
            raise RuntimeError("Firefox no expuso ningún contexto de navegación")
        self.context = contexts[0]["context"]
        self.ws.command("script.addPreloadScript", {
            "functionDeclaration": (
                "() => {"
                "  window.__e2eErrors = [];"
                "  window.addEventListener('error', (event) => {"
                "    if (event.target && event.target.tagName === 'IMG') return;"
                "    window.__e2eErrors.push('error: ' + String(event.message || event.error || 'desconocido'));"
                "  }, true);"
                "  window.addEventListener('unhandledrejection', (event) => {"
                "    window.__e2eErrors.push('unhandledrejection: ' + String(event.reason));"
                "  });"
                "  const original = console.error;"
                "  console.error = (...args) => {"
                "    window.__e2eErrors.push('console.error: ' + args.map((value) => {"
                "      try { return typeof value === 'string' ? value : JSON.stringify(value); }"
                "      catch (error) { return String(value); }"
                "    }).join(' '));"
                "    original.apply(console, args);"
                "  };"
                "  window.addEventListener('pagehide', () => { window.__e2eLeaving = true; });"
                "}"
            )
        })

    def _wait_for_bidi(self, timeout):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError("Firefox terminó antes de iniciar BiDi")
            readable, _, _ = select.select([self.process.stdout], [], [], 0.5)
            if not readable:
                continue
            line = self.process.stdout.readline()
            match = re.search(r"(ws://\S+)", line)
            if match:
                return match.group(1)
        raise RuntimeError("No se pudo descubrir el endpoint WebDriver BiDi")

    def evaluate(self, expression, await_promise=True):
        result = self.ws.command("script.evaluate", {
            "expression": expression,
            "target": {"context": self.context},
            "awaitPromise": await_promise,
            "resultOwnership": "none",
        })
        if result.get("type") != "success":
            raise RuntimeError(f"Evaluación JS falló: {result}")
        return result.get("result", {})

    def json(self, expression):
        value = self.evaluate(f"JSON.stringify({expression})").get("value")
        return json.loads(value)

    def wait_json(self, expression, predicate, timeout=30, description="condición"):
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            self.ws.pump(0.05)
            try:
                last = self.json(expression)
            except Exception as error:  # la página puede estar navegando
                last = error
                time.sleep(0.15)
                continue
            if predicate(last):
                return last
            time.sleep(0.15)
        raise AssertionError(f"No se cumplió {description} (último valor: {last!r})")

    def navigate(self, url):
        self.ws.events.clear()
        self.ws.command("browsingContext.navigate", {
            "context": self.context,
            "url": url,
            "wait": "complete",
        })

    def set_viewport(self, width, height):
        self.ws.command("browsingContext.setViewport", {
            "context": self.context,
            "viewport": {"width": width, "height": height},
            "devicePixelRatio": 1,
        })

    def screenshot(self, name):
        result = self.ws.command("browsingContext.captureScreenshot", {
            "context": self.context,
            "format": {"type": "png"},
        })
        path = name if os.path.isabs(name) else os.path.join(SCREENSHOT_DIR, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(base64.b64decode(result["data"]))
        log(f"CAPTURA  {path}")
        return path

    def assert_no_errors(self, phase):
        self.ws.pump(0.4)
        errors = self.json("window.__e2eErrors || []")
        errors += self.ws.console_errors()
        check(not errors, f"{phase}: sin errores de consola ({len(errors)} encontrados: {errors[:5]!r})")
        return errors

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass
        try:
            os.killpg(os.getpgid(self.process.pid), 15)
        except Exception:
            pass
        try:
            self.process.wait(timeout=15)
        except Exception:
            try:
                os.killpg(os.getpgid(self.process.pid), 9)
            except Exception:
                pass
        shutil.rmtree(self.profile, ignore_errors=True)


class StaticServer:
    def __init__(self, directory):
        self.directory = directory
        self.port = free_port()
        self.log_path = os.path.join(tempfile.gettempdir(), "adahra-e2e-server.log")
        self.log_file = open(self.log_path, "w", encoding="utf-8")
        self.process = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(self.port), "--bind", "127.0.0.1"],
            cwd=directory,
            stdout=self.log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        self.base = f"http://127.0.0.1:{self.port}"
        self.wait_ready()

    def wait_ready(self):
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                status, _ = http_status(self.base + "/index.html")
                if status == 200:
                    return
            except Exception:
                time.sleep(0.2)
        raise RuntimeError("El servidor estático no respondió")

    def close(self):
        try:
            os.killpg(os.getpgid(self.process.pid), 15)
        except Exception:
            pass
        try:
            self.process.wait(timeout=10)
        except Exception:
            try:
                os.killpg(os.getpgid(self.process.pid), 9)
            except Exception:
                pass
        self.log_file.close()


def verify_http(base):
    expected = {
        "/index.html": "text/html",
        "/admin.html": "text/html",
        "/public-app.js": "javascript",
        "/admin-app.js": "javascript",
        "/properties-data.js": "javascript",
        "/data/properties.json": "application/json",
        "/assets/adahra-logo-full.webp": "image/webp",
        "/assets/adahra-mark.webp": "image/webp",
        "/assets/favicon.png": "image/png",
    }
    for path, content_type in expected.items():
        status, actual = http_status(base + path)
        check(status == 200, f"HTTP 200 en {path}")
        check(content_type in actual, f"content-type de {path}: {actual!r}")

    try:
        http_status(base + "/firebase-config.js")
        raise AssertionError("firebase-config.js no debe existir")
    except Exception:
        log("PASS  firebase-config.js ya no existe")


def verify_publication(site_dir):
    """Sirve el artefacto de Pages: sólo público, sin editor ni originales."""
    if not os.path.isfile(os.path.join(site_dir, "index.html")):
        log("SKIP  _site/ aún no existe; ejecuta npm run build:pages")
        return

    server = StaticServer(site_dir)
    try:
        expected = {
            "/index.html": "text/html",
            "/public-app.js": "javascript",
            "/properties-data.js": "javascript",
            "/data/properties.json": "application/json",
            "/assets/adahra-logo-full.webp": "image/webp",
            "/assets/adahra-mark.webp": "image/webp",
            "/assets/favicon.png": "image/png",
        }
        for path, content_type in expected.items():
            status, actual = http_status(server.base + path)
            check(status == 200, f"_site HTTP 200 en {path}")
            check(content_type in actual, f"_site content-type de {path}: {actual!r}")

        for path in ("/admin.html", "/admin-app.js", "/package.json", "/tests/e2e-browser.py"):
            try:
                status, _ = http_status(server.base + path)
                raise AssertionError(f"_site no debe publicar {path} (respondió {status})")
            except urllib.error.HTTPError as error:
                check(error.code == 404, f"_site no publica {path} (HTTP {error.code})")

        try:
            http_status(server.base + "/WhatsApp%20Image%202026-10-28%20at%205.25.04%20PM.jpeg")
            raise AssertionError("_site no debe publicar fotos originales de WhatsApp")
        except urllib.error.HTTPError as error:
            check(error.code == 404, f"_site no publica originales de WhatsApp (HTTP {error.code})")
    finally:
        server.close()


def public_state(browser):
    return browser.json("""(() => {
      const counter = document.getElementById('results-counter');
      const grid = document.getElementById('catalog-grid');
      const empty = document.getElementById('empty-state');
      return {
        ready: document.readyState,
        counter: counter ? counter.textContent.trim() : null,
        cards: grid ? grid.querySelectorAll('.property-card').length : -1,
        emptyTitle: document.getElementById('empty-title')
          ? document.getElementById('empty-title').textContent.trim() : null,
        emptyHidden: empty ? empty.hidden : null,
        total: document.getElementById('hero-count-properties')
          ? document.getElementById('hero-count-properties').textContent.trim() : null,
        adminLinks: document.querySelectorAll('a[href*="admin"]').length,
        deployLink: document.querySelectorAll('a[href*="DEPLOY"]').length,
        storageWarning: !document.getElementById('catalog-storage-warning').hidden,
        firebaseResources: performance.getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => /gstatic\\.com\\/firebasejs|firestore\\.googleapis|identitytoolkit/.test(name))
      };
    })()""")


def admin_state(browser):
    return browser.json("""(() => {
      const rows = document.querySelectorAll('#record-body tr');
      return {
        ready: document.readyState,
        counter: document.getElementById('records-count')
          ? document.getElementById('records-count').textContent.trim() : null,
        rows: rows.length,
        dirty: document.getElementById('dirty-state')
          ? document.getElementById('dirty-state').dataset.dirty : null,
        dirtyText: document.getElementById('dirty-state')
          ? document.getElementById('dirty-state').textContent.trim() : null,
        banner: document.getElementById('permanent-banner')
          ? document.getElementById('permanent-banner').textContent : '',
        login: Boolean(document.getElementById('login-form') || document.getElementById('auth-panel')),
        warning: document.getElementById('editor-warning')
          ? document.getElementById('editor-warning').textContent.trim() : null
      };
    })()""")


def open_editor(browser, property_id=None):
    if property_id:
        browser.evaluate(f"""(() => {{
          const button = [...document.querySelectorAll('.record-edit')]
            .find((item) => item.dataset.id === '{property_id}');
          if (!button) throw new Error('No existe la ficha {property_id}');
          button.click();
        }})()""")
    else:
        browser.evaluate("document.getElementById('btn-add').click()")
    browser.wait_json(
        "document.getElementById('editor-dialog').open",
        lambda value: value is True,
        description="diálogo de edición abierto"
    )


def fill_editor(browser, values):
    script = """(() => {
      const set = (id, value, eventName) => {
        const element = document.getElementById(id);
        element.value = value;
        element.dispatchEvent(new Event(eventName || 'input', { bubbles: true }));
      };
      %s
    })()""" % "\n".join(
        f"set({json.dumps(key)}, {json.dumps(value)});" for key, value in values.items()
    )
    browser.evaluate(script)


def run_empty_scenario(browser, base):
    browser.navigate(base + "/index.html")
    state = browser.wait_json(
        "(() => { const c = document.getElementById('results-counter'); return c ? c.textContent.trim() : null; })()",
        lambda value: value == "0 de 0 propiedades",
        description="catálogo vacío cargado"
    )
    check(state == "0 de 0 propiedades", "público vacío: contador 0 de 0")
    public = public_state(browser)
    check(public["cards"] == 0, "público vacío: ninguna tarjeta")
    check(public["emptyTitle"] == "Catálogo vacío", "público vacío: mensaje Catálogo vacío")
    retry = browser.json("(() => ({ retryHidden: document.getElementById('btn-empty-retry').hidden, similar: document.getElementById('modal-similar').hidden }))()")
    check(retry["retryHidden"] is False, "público vacío: botón Reintentar visible")
    check(retry["similar"] is True, "público: sección de fichas similares inicia oculta")
    check(public["adminLinks"] == 0, "público: sin enlaces al editor local")
    check(public["deployLink"] == 0, "público: sin enlaces a DEPLOY")
    check(public["firebaseResources"] == [], "público: sin recursos Firebase")
    browser.assert_no_errors("público vacío")

    browser.navigate(base + "/admin.html")
    admin = browser.wait_json(
        "document.readyState === 'complete' && document.getElementById('records-count') ? document.getElementById('records-count').textContent.trim() : null",
        lambda value: value is not None,
        description="editor cargado"
    )
    admin = admin_state(browser)
    check(admin["counter"] == "0 de 0 propiedades", "editor: inicia sin catálogo cargado")
    check(admin["dirty"] == "false", "editor: inicia limpio")
    check("no escribe en Internet" in admin["banner"], "editor: banner explica que no publica")
    check(not admin["login"], "editor: no hay login ni panel de autenticación")
    check(admin["warning"] is None or admin["warning"] == "", "editor: sin advertencia al iniciar")

    browser.evaluate("document.getElementById('btn-load-current').click()")
    browser.wait_json(
        "document.getElementById('records-count').textContent.trim()",
        lambda value: value == "0 de 0 propiedades",
        description="carga del JSON vacío"
    )
    admin = admin_state(browser)
    check(admin["rows"] == 0, "editor: carga el catálogo vacío sin filas")
    check(admin["dirty"] == "false", "editor: cargar no marca cambios")
    browser.assert_no_errors("editor vacío")


def build_fixture():
    return {
        "version": 1,
        "updatedAt": "2026-03-01T12:00:00.000Z",
        "properties": [
            {
                "id": "UI-001",
                "title": "Casa con patio en Del Valle",
                "operation": "venta",
                "type": "casa",
                "neighborhood": "Del Valle",
                "city": "Ciudad de México",
                "state": "CDMX",
                "address": "Calle de prueba 123",
                "price": 4500000,
                "construction": 220,
                "lot": 300,
                "beds": 3,
                "baths": 2.5,
                "parking": 2,
                "year": 2015,
                "description": "Casa de dos niveles con patio, luz natural y cocina integral.",
                "features": ["Patio", "Cochera", "Cocina integral"],
                "image": "https://example.com/casa.jpg",
                "alt": "Fachada de casa con patio",
                "createdAt": "2026-01-10T12:00:00.000Z",
                "updatedAt": "2026-02-15T18:30:00.000Z"
            },
            {
                "id": "UI-002",
                "title": "Departamento con terraza en Condesa",
                "operation": "renta",
                "type": "departamento",
                "neighborhood": "Condesa",
                "city": "Ciudad de México",
                "state": "CDMX",
                "address": "Avenida de prueba 456",
                "price": 28000,
                "construction": 95,
                "lot": None,
                "beds": 2,
                "baths": 2,
                "parking": 1,
                "year": 2019,
                "description": "Departamento luminoso con terraza y acabados recientes.",
                "features": ["Terraza", "Elevador", "Seguridad 24/7"],
                "image": "https://example.com/departamento.jpg",
                "alt": "Terraza de departamento",
                "createdAt": "2026-02-01T09:00:00.000Z",
                "updatedAt": "2026-02-20T11:15:00.000Z"
            }
        ]
    }


def prepare_full_copy():
    temporary = tempfile.mkdtemp(prefix="adahra-e2e-site-")
    target = os.path.join(temporary, "site")

    def ignore(directory, names):
        ignored = set()
        for name in names:
            if name in {"_site", "node_modules", ".git", ".github", "tests", "scripts"}:
                ignored.add(name)
        return ignored

    shutil.copytree(PROJECT_DIR, target, ignore=ignore)
    with open(os.path.join(target, "data", "properties.json"), "w", encoding="utf-8") as handle:
        json.dump(build_fixture(), handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    return temporary, target


def run_full_scenario(browser, base):
    browser.navigate(base + "/index.html")
    public = browser.wait_json(
        "(() => { const c = document.getElementById('results-counter'); return c ? c.textContent.trim() : null; })()",
        lambda value: value == "2 de 2 propiedades",
        description="catálogo de dos fichas"
    )
    check(public == "2 de 2 propiedades", "público: renderiza 2 de 2 propiedades")
    state = public_state(browser)
    check(state["cards"] == 2, "público: dos tarjetas")
    check(state["total"] == "02", "público: contador del hero en 02")
    check(state["emptyHidden"], "público: estado vacío oculto")
    browser.assert_no_errors("público lleno")

    browser.set_viewport(1440, 1200)
    browser.evaluate("window.scrollTo(0, 0)")
    browser.screenshot("/tmp/adahra-public-desktop.png")

    browser.set_viewport(360, 800)
    browser.evaluate("window.scrollTo(0, 0)")
    mobile_fit = browser.json("({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth })")
    check(mobile_fit["width"] <= mobile_fit["viewport"], "público: sin desbordamiento horizontal en 360")
    browser.screenshot("/tmp/adahra-public-mobile.png")

    browser.evaluate("document.getElementById('menu-toggle').click()")
    menu = browser.json("""({
      expanded: document.getElementById('menu-toggle').getAttribute('aria-expanded'),
      visible: getComputedStyle(document.getElementById('primary-nav')).display !== 'none',
      label: document.getElementById('menu-toggle').textContent.trim()
    })""")
    check(menu["expanded"] == "true" and menu["visible"], "público móvil: menú desplegable accesible")
    check("Cerrar" in menu["label"], "público móvil: etiqueta del menú cambia a Cerrar")
    browser.screenshot("02b-menu-movil.png")
    browser.evaluate("document.getElementById('menu-toggle').click()")
    check(browser.json("document.getElementById('menu-toggle').getAttribute('aria-expanded')") == "false", "público móvil: menú se cierra")

    browser.set_viewport(768, 1024)
    browser.evaluate("window.scrollTo(0, 0)")
    tablet = browser.json("""({
      width: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      menu: getComputedStyle(document.getElementById('menu-toggle')).display,
      nav: getComputedStyle(document.getElementById('primary-nav')).display
    })""")
    check(tablet["width"] <= tablet["viewport"], "público: sin desbordamiento horizontal en 768")
    check(tablet["menu"] != "none" and tablet["nav"] == "none", "público tablet: menú móvil disponible y navegación colapsada")

    browser.set_viewport(1440, 1200)
    browser.evaluate("window.scrollTo(0, 0)")
    browser.evaluate("document.documentElement.style.scrollBehavior = 'auto'; document.getElementById('catalogo').scrollIntoView();")
    browser.wait_json("window.scrollY > 100", lambda value: value is True, description="catálogo desplazado")
    desktop_fit = browser.json("({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth })")
    check(desktop_fit["width"] <= desktop_fit["viewport"], "público: sin desbordamiento horizontal en 1440")
    layout = browser.json("""(() => {
      const header = document.getElementById('site-header').getBoundingClientRect();
      const section = document.getElementById('catalogo').getBoundingClientRect();
      return {
        gap: Number((section.top - header.bottom).toFixed(2)),
        scrollPadding: getComputedStyle(document.documentElement).scrollPaddingTop,
        sectionTop: Number(section.top.toFixed(2)),
        headerBottom: Number(header.bottom.toFixed(2))
      };
    })()""")
    check(layout["scrollPadding"] == "99.2px", f"público: scroll-padding-top de escritorio conservado ({layout['scrollPadding']})")
    check(layout["gap"] <= 0.5, f"público: sin banda marina entre header y catálogo (gap {layout['gap']}px)")
    check(layout["gap"] >= -24, f"público: catálogo no queda oculto bajo el header (gap {layout['gap']}px)")
    browser.screenshot("/tmp/adahra-catalog-desktop.png")

    browser.evaluate("""(() => {
      const search = document.getElementById('filter-search');
      search.value = 'UI-002';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    })()""")
    browser.wait_json(
        "document.getElementById('results-counter').textContent.trim()",
        lambda value: value == "1 de 2 propiedades",
        description="filtro por clave"
    )
    check(True, "público: filtro por clave reduce a 1 de 2")

    browser.evaluate("document.getElementById('btn-clear-filters').click()")
    browser.wait_json(
        "document.getElementById('results-counter').textContent.trim()",
        lambda value: value == "2 de 2 propiedades",
        description="limpieza de filtros"
    )
    check(True, "público: limpiar filtros restaura 2 de 2")

    browser.evaluate("document.querySelector('.property-card .card-open').click()")
    browser.wait_json(
        "document.getElementById('property-modal').open",
        lambda value: value is True,
        description="modal abierto"
    )
    modal = browser.json("""({
      title: document.getElementById('modal-title').textContent.trim(),
      code: document.getElementById('modal-code').textContent.trim(),
      specs: document.getElementById('modal-specs').children.length
    })""")
    check(modal["title"] == "Casa con patio en Del Valle", "público: modal muestra la ficha correcta")
    check(modal["code"] == "Ficha UI-001", "público: modal muestra la clave")
    check(modal["specs"] >= 3, "público: modal lista especificaciones")

    similar = browser.json("""({
      hidden: document.getElementById('modal-similar').hidden,
      items: document.querySelectorAll('#modal-similar-list .similar-item').length,
      first: document.querySelector('#modal-similar-list .similar-item span')?.textContent.trim() || ''
    })""")
    check(similar["hidden"] is False, "público: modal muestra fichas similares")
    check(similar["items"] == 1, "público: una ficha similar real")
    check(similar["first"].startswith("UI-002"), "público: similar corresponde a la otra ficha")
    media_state = browser.wait_json(
        """(() => {
          const image = document.getElementById('modal-img');
          const fallback = document.getElementById('modal-fallback');
          const label = fallback.querySelector('.fallback-label').textContent.trim();
          if (image.complete && image.naturalWidth > 0) return 'imagen';
          if (!fallback.hidden && label === 'Imagen no disponible') return 'fallback';
          return label;
        })()""",
        lambda value: value in {"imagen", "fallback"},
        description="modal con imagen o fallback resuelto"
    )
    check(media_state in {"imagen", "fallback"}, f"público: modal sin carga perpetua ({media_state})")
    browser.screenshot("/tmp/adahra-modal-desktop.png")

    browser.evaluate("document.querySelector('#modal-similar-list .similar-item').click()")
    browser.wait_json(
        "document.getElementById('modal-title').textContent.trim()",
        lambda value: value == "Departamento con terraza en Condesa",
        description="navegación entre fichas similares"
    )
    check(True, "público: navegación a ficha similar")
    browser.evaluate("document.getElementById('modal-close-bottom').click()")

    browser.evaluate("document.querySelector('.property-card .fav-btn').click()")
    browser.wait_json(
        f"JSON.parse(localStorage.getItem('{FAVORITES_KEY}') || '[]')",
        lambda value: value == ["UI-001"],
        description="favorito guardado"
    )
    check(True, "público: favorito guardado en localStorage")
    browser.evaluate("document.getElementById('filter-favs-only').click()")
    browser.wait_json(
        "document.getElementById('results-counter').textContent.trim()",
        lambda value: value == "1 de 2 propiedades",
        description="filtro de favoritos"
    )
    check(True, "público: filtro Sólo favoritos muestra 1 de 2")
    browser.evaluate("document.getElementById('filter-favs-only').click()")
    browser.wait_json(
        "document.getElementById('results-counter').textContent.trim()",
        lambda value: value == "2 de 2 propiedades",
        description="favoritos desactivados"
    )
    browser.assert_no_errors("público interactivo")

    browser.set_viewport(1440, 1200)
    browser.evaluate("""(() => {
      const set = (id, value, eventName) => {
        const element = document.getElementById(id);
        element.value = value;
        element.dispatchEvent(new Event(eventName || 'input', { bubbles: true }));
      };
      set('contact-name', 'Ana Martínez');
      set('contact-email', 'ana@dominio.mx');
      set('contact-phone', '5512345678');
      set('contact-property', 'UI-002', 'change');
      set('contact-message', 'Busco un departamento de dos recámaras para renta en Condesa.');
      const privacy = document.getElementById('contact-privacy');
      privacy.checked = true;
      privacy.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('contact-form').requestSubmit();
    })()""")
    browser.wait_json(
        "document.getElementById('form-success').hidden",
        lambda value: value is False,
        description="consulta local validada"
    )
    success = browser.evaluate("document.getElementById('form-success').textContent").get("value", "")
    check("no envía" in success and "servidor" in success, "público: formulario declara validación local sin envío")
    check(browser.json("document.getElementById('contact-name').value") == "", "público: formulario se limpia tras validar")
    browser.assert_no_errors("público contacto")

    browser.set_viewport(1440, 1200)
    browser.navigate(base + "/admin.html")
    browser.wait_json(
        "document.getElementById('records-count') ? document.getElementById('records-count').textContent.trim() : null",
        lambda value: value is not None,
        description="editor cargado"
    )
    browser.evaluate("document.getElementById('btn-load-current').click()")
    admin = browser.wait_json(
        "(() => ({count: document.getElementById('records-count').textContent.trim(), dirty: document.getElementById('dirty-state').dataset.dirty}))()",
        lambda value: value.get("count") == "2 de 2 propiedades" and value.get("dirty") == "false",
        description="editor carga las dos fichas"
    )
    check(admin["count"] == "2 de 2 propiedades", "editor: carga 2 de 2 propiedades")
    browser.evaluate("window.scrollTo(0, 0)")
    browser.screenshot("05-editor-local.png")
    browser.screenshot("/tmp/adahra-admin-desktop.png")

    open_editor(browser)
    browser.evaluate("document.getElementById('property-form').requestSubmit()")
    browser.wait_json(
        "!document.getElementById('editor-errors').hidden",
        lambda value: value is True,
        description="errores de validación visibles"
    )
    error_text = browser.evaluate("document.getElementById('editor-errors').textContent.trim()").get("value", "")
    check("Revisa" in error_text or "revisa" in error_text, "editor: valida formulario vacío")

    fill_editor(browser, {
        "field-title": "Penthouse de prueba en Polanco",
        "field-operation": "venta",
        "field-type": "penthouse",
        "field-neighborhood": "Polanco",
        "field-city": "Ciudad de México",
        "field-state": "CDMX",
        "field-address": "Calle de prueba 789",
        "field-price": "8,900,000",
        "field-construction": "180",
        "field-lot": "180",
        "field-beds": "3",
        "field-baths": "3.5",
        "field-parking": "2",
        "field-year": "2021",
        "field-description": "Penthouse de prueba con terraza privada, vista abierta y acabados de alta calidad.",
        "field-features": "Terraza privada\nVista abierta\nSeguridad 24/7",
        "field-image": "https://example.com/penthouse.jpg",
        "field-alt": "Terraza de penthouse con vista abierta"
    })
    browser.evaluate("document.getElementById('field-type').dispatchEvent(new Event('change', { bubbles: true }))")
    browser.evaluate("document.getElementById('property-form').requestSubmit()")
    browser.wait_json(
        "document.getElementById('records-count').textContent.trim()",
        lambda value: value == "3 de 3 propiedades",
        description="alta de propiedad"
    )
    admin = admin_state(browser)
    check(admin["rows"] == 3, "editor: alta agrega una tercera fila")
    check(admin["dirty"] == "true", "editor: alta marca cambios sin exportar")
    check("UI-003" in browser.evaluate("document.getElementById('record-body').textContent").get("value", ""), "editor: nueva ficha UI-003")
    browser.assert_no_errors("editor alta")

    guarded = browser.evaluate("""(() => {
      const event = new Event('beforeunload', { cancelable: true });
      return window.dispatchEvent(event) === false;
    })()""").get("value")
    check(guarded is True, "editor: beforeunload protege cambios sin exportar")

    browser.evaluate("""(() => {
      window.showSaveFilePicker = undefined;
      window.__exportedBlob = null;
      URL.createObjectURL = (blob) => { window.__exportedBlob = blob; return 'blob:e2e'; };
      URL.revokeObjectURL = () => {};
      HTMLAnchorElement.prototype.click = function () { window.__downloadName = this.download; };
      document.getElementById('btn-export').click();
    })()""")
    browser.wait_json(
        "document.getElementById('dirty-state').dataset.dirty === 'false' && window.__exportedBlob !== null",
        lambda value: value is True,
        description="exportación completada"
    )
    exported = browser.evaluate("window.__exportedBlob.text()").get("value")
    check(exported is not None, "editor: exporta un Blob")
    parsed = json.loads(exported)
    check(parsed["version"] == 1, "exportación: version 1")
    check(len(parsed["properties"]) == 3, "exportación: tres propiedades")
    check([item["id"] for item in parsed["properties"]] == ["UI-001", "UI-002", "UI-003"], "exportación: orden por clave")
    check(browser.evaluate("window.__downloadName").get("value") == "properties.json", "exportación: descarga properties.json")
    check(browser.json("document.getElementById('dirty-state').dataset.dirty") == "false", "editor: exportar limpia el estado dirty")

    browser.evaluate(f"""(() => {{
      const file = new File([{json.dumps(exported)}], 'properties.json', {{ type: 'application/json' }});
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = document.getElementById('import-input');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', {{ bubbles: true }}));
    }})()""")
    browser.wait_json(
        "(() => ({count: document.getElementById('records-count').textContent.trim(), dirty: document.getElementById('dirty-state').dataset.dirty}))()",
        lambda value: value.get("count") == "3 de 3 propiedades" and value.get("dirty") == "false",
        description="reimportación del JSON exportado"
    )
    check(True, "editor: reimporta el JSON exportado con 3 de 3")

    open_editor(browser, "UI-003")
    fill_editor(browser, {
        "field-title": "Penthouse editado en Polanco",
        "field-description": "Penthouse editado con terraza privada, vista abierta y acabados de alta calidad."
    })
    browser.evaluate("document.getElementById('property-form').requestSubmit()")
    browser.wait_json(
        "document.getElementById('record-body').textContent.includes('Penthouse editado en Polanco')",
        lambda value: value is True,
        description="edición de ficha"
    )
    check(admin_state(browser)["dirty"] == "true", "editor: edición marca cambios")

    browser.evaluate("""(() => {
      const button = [...document.querySelectorAll('.record-delete')]
        .find((item) => item.dataset.id === 'UI-003');
      button.click();
    })()""")
    browser.wait_json(
        "document.getElementById('delete-dialog').open",
        lambda value: value is True,
        description="confirmación de borrado"
    )
    browser.evaluate("document.getElementById('delete-confirm').click()")
    browser.wait_json(
        "document.getElementById('records-count').textContent.trim()",
        lambda value: value == "2 de 2 propiedades",
        description="borrado de ficha"
    )
    check(admin_state(browser)["dirty"] == "true", "editor: borrado marca cambios")
    check("UI-003" not in browser.evaluate("document.getElementById('record-body').textContent").get("value", ""), "editor: UI-003 eliminada de la tabla")
    browser.assert_no_errors("editor completo")


def run_reduced_motion_scenario(browser, base):
    browser.navigate(base + "/index.html")
    browser.wait_json("document.readyState", lambda value: value == "complete", description="inicio con movimiento reducido")
    state = browser.json("""(() => {
      const icon = document.querySelector('.menu-toggle-icon');
      const transition = parseFloat(getComputedStyle(icon).transitionDuration);
      return {
        reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
        scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
        transition: Number.isFinite(transition) ? transition : 0
      };
    })()""")
    check(state["reduce"] is True, "reduced motion: Firefox anuncia prefers-reduced-motion")
    check(state["scrollBehavior"] == "auto", "reduced motion: scroll suave desactivado")
    check(state["transition"] <= 0.001, f"reduced motion: transiciones casi nulas ({state['transition']}s)")
    browser.assert_no_errors("reduced motion")


def main():
    browser = None
    reduced_browser = None
    servers = []
    temporary = None
    try:
        server = StaticServer(PROJECT_DIR)
        servers.append(server)
        verify_http(server.base)
        verify_publication(os.path.join(PROJECT_DIR, "_site"))

        browser = Browser()
        run_empty_scenario(browser, server.base)

        temporary, full_site = prepare_full_copy()
        full_server = StaticServer(full_site)
        servers.append(full_server)
        run_full_scenario(browser, full_server.base)

        browser.close()
        browser = None
        reduced_browser = Browser(prefers_reduced_motion=True)
        run_reduced_motion_scenario(reduced_browser, server.base)

        log("E2E OK · público vacío, catálogo lleno, editor local y reduced motion verificados")
        log("CAPTURAS · /tmp/adahra-public-desktop.png /tmp/adahra-public-mobile.png "
            "/tmp/adahra-catalog-desktop.png /tmp/adahra-modal-desktop.png /tmp/adahra-admin-desktop.png")
    finally:
        if browser:
            browser.close()
        if reduced_browser:
            reduced_browser.close()
        for server in reversed(servers):
            server.close()
        if temporary:
            shutil.rmtree(temporary, ignore_errors=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"E2E FALLÓ: {error}", file=sys.stderr)
        sys.exit(1)
