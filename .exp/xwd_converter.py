import struct
import sys

def xwd_to_bmp(xwd_path, bmp_path):
    with open(xwd_path, 'rb') as f:
        header = f.read(100)
        # XWD header format (big-endian 32-bit ints)
        # header_size, file_version, pixmap_format, pixmap_depth, pixmap_width, pixmap_height, ...
        fields = struct.unpack('>8I', header[:32])
        header_size = fields[0]
        pixmap_depth = fields[3]
        width = fields[4]
        height = fields[5]
        
        f.seek(0)
        full_header = f.read(header_size)
        raw_data = f.read()
        
    print(f"XWD info: {width}x{height}, depth={pixmap_depth}, header_size={header_size}, data_len={len(raw_data)}")
    
    # Save as PPM (P6)
    ppm_header = f"P6\n{width} {height}\n255\n".encode('ascii')
    
    # Convert BGRA / BGRX / RGBA to RGB
    rgb_data = bytearray(width * height * 3)
    
    bytes_per_pixel = 4 if len(raw_data) >= width * height * 4 else 3
    
    dst_idx = 0
    for i in range(0, width * height * bytes_per_pixel, bytes_per_pixel):
        b = raw_data[i]
        g = raw_data[i+1]
        r = raw_data[i+2]
        rgb_data[dst_idx] = r
        rgb_data[dst_idx+1] = g
        rgb_data[dst_idx+2] = b
        dst_idx += 3
        
    ppm_path = bmp_path.replace('.png', '.ppm')
    with open(ppm_path, 'wb') as out_f:
        out_f.write(ppm_header)
        out_f.write(rgb_data)
        
    print(f"Saved PPM to {ppm_path}")

if __name__ == '__main__':
    xwd_to_bmp('/tmp/screen.xwd', '/tmp/screen.png')
