import osmium
import os

class EmergencyExtractor(osmium.SimpleHandler):
    def __init__(self, writer):
        super(EmergencyExtractor, self).__init__()
        self.writer = writer

    def is_target(self, tags):
        # Broad categories to ensure Mittal and Prem hospitals are caught
        medical = ['hospital', 'clinic', 'doctors', 'health_post', 'healthcare_centre']
        police = ['police', 'fire_station']
        
        # Check standard amenity and modern healthcare tags
        return tags.get('amenity') in medical + police or \
               tags.get('healthcare') in ['hospital', 'clinic', 'centre']

    def node(self, n):
        if self.is_target(n.tags):
            self.writer.add_node(n)

    def way(self, w):
        if self.is_target(w.tags):
            self.writer.add_way(w)

# Define paths
input_file = "india-260430.osm.pbf"
output_file = "emergency_filtered.osm.pbf"

# Manual setup to avoid Windows 'different disk drive' move errors
writer = osmium.SimpleWriter(output_file)
handler = EmergencyExtractor(writer)

print(f"Scanning {input_file} for all emergency facilities...")
handler.apply_file(input_file)
writer.close()

print(f"Success! Created {output_file}")