export interface GeocodedLocation {
  latitude: number;
  longitude: number;
  address: string;
}

// Uses OpenStreetMap's Nominatim (free, keyless) for reverse geocoding.
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
          resolve({ latitude, longitude, address: data.display_name ?? "" });
        } catch {
          resolve({ latitude, longitude, address: "" });
        }
      },
      (err) => reject(new Error(err.message || "Could not determine your location.")),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}
