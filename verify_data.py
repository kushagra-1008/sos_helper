import sqlite3

def check_hospitals():
    try:
        conn = sqlite3.connect('india_sos.db')
        cursor = conn.cursor()
        
        # Searching for Mittal and Prem to confirm Ajmer coverage
        query = "SELECT name, category, lat, lon FROM facilities WHERE name LIKE '%Mittal%' OR name LIKE '%Prem%'"
        cursor.execute(query)
        
        results = cursor.fetchall()
        
        if not results:
            print("No results found. We might need to check the filtering tags.")
        else:
            print(f"Found {len(results)} facilities:")
            for row in results:
                print(f"Name: {row[0]} | Category: {row[1]} | Coords: {row[2]}, {row[3]}")
                
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_hospitals()