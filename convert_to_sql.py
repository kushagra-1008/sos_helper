import osmium
import sqlite3

class SQLiteWriter(osmium.SimpleHandler):
    def __init__(self, cursor):
        super(SQLiteWriter, self).__init__()
        self.cursor = cursor

    def node(self, n):
        self.save(n.tags, n.location.lat, n.location.lon)

    def way(self, w):
        # This handles large hospital buildings by finding the center point
        try:
            lat = sum(p.lat for p in w.nodes) / len(w.nodes)
            lon = sum(p.lon for p in w.nodes) / len(w.nodes)
            self.save(w.tags, lat, lon)
        except Exception:
            pass 

    def save(self, tags, lat, lon):
        # Normalize the name and category
        name = tags.get('name', 'Unnamed Emergency Facility')
        category = tags.get('amenity') or tags.get('healthcare') or 'emergency'
        
        self.cursor.execute(
            "INSERT INTO facilities (name, category, lat, lon) VALUES (?, ?, ?, ?)",
            (name, category, lat, lon)
        )

# 1. Connect to Database
conn = sqlite3.connect('india_sos.db')
c = conn.cursor()
c.execute("DROP TABLE IF EXISTS facilities")
c.execute('''CREATE TABLE facilities 
             (id INTEGER PRIMARY KEY, name TEXT, category TEXT, lat REAL, lon REAL)''')

# 2. Process the Filtered PBF
handler = SQLiteWriter(c)
print("Converting filtered data to SQLite database...")

# locations=True is CRITICAL here to get the coordinates for 'ways'
handler.apply_file("emergency_filtered.osm.pbf", locations=True)

conn.commit()
conn.close()
print("Success! 'india_sos.db' is ready.")