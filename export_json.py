import sqlite3
import json

def export_to_json():
    conn = sqlite3.connect('india_sos.db')
    cursor = conn.cursor()

    # We fetch EVERYTHING now to ensure we don't miss anything near you
    cursor.execute("SELECT name, category, lat, lon FROM facilities")
    rows = cursor.fetchall()

    data = []
    for row in rows:
        data.append({
            "name": row[0],
            "type": row[1],
            "lat": row[2],
            "lon": row[3]
        })

    with open('emergency_data.json', 'w') as f:
        json.dump(data, f)

    print(f"Success! Exported {len(data)} emergency points to emergency_data.json")
    conn.close()

if __name__ == "__main__":
    export_to_json()