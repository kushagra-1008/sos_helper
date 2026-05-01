# Offline Emergency SOS Helper

An offline-first, Progressive Web App (PWA) designed to find the nearest hospitals, police stations, and fire stations across India without requiring an active internet connection.

## Features
- **True Offline Support**: Service worker pre-caches the entire UI and the local emergency facilities database.
- **Local Location Processing**: Computes Haversine distance locally on the device; no API calls needed.
- **Offline Maps**: Automatically caches Leaflet/OpenStreetMap tiles as you browse, ensuring they are available offline during an emergency.
- **Bounding Box Optimization**: Instantly calculates distance against 120,000+ nodes using localized bounding-box pre-filtering.

## How to use
1. Launch the app (or run locally using `python -m http.server 8080`).
2. Wait for the Service Worker to cache assets on the first load.
3. Disconnect from the internet.
4. Click **Find Nearby Help**. Your device's native GPS will locate you and calculate the closest facilities.

*Data sourced from OpenStreetMap.*
