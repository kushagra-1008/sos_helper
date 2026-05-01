# Save as check_ajmer.py
import sqlite3
conn = sqlite3.connect('india_sos.db')
cursor = conn.cursor()
# Search in a 5km box around Ajmer center
cursor.execute("SELECT name FROM facilities WHERE lat BETWEEN 26.40 AND 26.55 AND lon BETWEEN 74.60 AND 74.70")
results = cursor.fetchall()
print(f"Facilities found in Ajmer area: {len(results)}")
for r in results: print(r[0])