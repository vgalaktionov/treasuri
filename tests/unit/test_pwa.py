from __future__ import annotations


def test_manifest_is_public_static_asset(client) -> None:
    response = client.get("/static/site.webmanifest")

    assert response.status_code == 200
    assert response.json["name"] == "Treasuri"
    assert response.json["display"] == "standalone"


def test_service_worker_avoids_precaching_financial_pages(client) -> None:
    response = client.get("/service-worker.js")

    assert response.status_code == 200
    assert response.headers["Service-Worker-Allowed"] == "/"
    body = response.get_data(as_text=True)
    assert "/static/offline.html" in body
    assert "/static/js/offline-summary.js" in body
    assert '"/"' not in body
    assert "/transactions" not in body


def test_offline_page_can_render_last_known_dashboard_summary(client) -> None:
    response = client.get("/static/offline.html")

    assert response.status_code == 200
    assert b"Last known dashboard summary" in response.data
    assert b"data-offline-summary" in response.data
    assert b"offline-summary.js" in response.data
    assert b"Sample Supermarket" not in response.data


def test_base_template_registers_pwa_assets(client) -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert b"site.webmanifest" in response.data
    assert b"service-worker.js" in response.data
    assert b"treasuri-offline-summary" in response.data
    assert b"offline-summary.js" in response.data
