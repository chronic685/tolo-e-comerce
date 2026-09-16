export interface GeocodedLocation {
  latitude: number;
  longitude: number;
  line1: string;
  city: string;
  subCity: string;
}

// Uses OpenStreetMap's Nominatim (free, keyless) for reverse geocoding —
// good enough for an MVP; swap for Google/Mapbox later if higher volume or
// accuracy is needed. Requires the browser's Geolocation permission.
export function getCurrentLocation(): Promise<GeocodedLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location services are not available on this device."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
            { headers: { Accept: "application/json" } },
          );
          const data = await res.json();
          const addr = data.address ?? {};
          resolve({
            latitude,
            longitude,
            line1: [addr.road, addr.neighbourhood].filter(Boolean).join(", ") || data.display_name || "",
            city: addr.city ?? addr.town ?? addr.county ?? "",
            subCity: addr.suburb ?? addr.city_district ?? "",
          });
        } catch {
          resolve({ latitude, longitude, line1: "", city: "", subCity: "" });
        }
      },
      (err) => reject(new Error(err.message || "Could not determine your location.")),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}
