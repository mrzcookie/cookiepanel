package drive

import "testing"

// A realistic lsblk dump: a system disk (sda, root on a partition), a blank
// unformatted disk (sdb), and a formatted+mounted data disk (sdc). sdc uses the
// newer `mountpoints` array; sda uses a mix; sizes come as JSON numbers.
const lsblkSample = `{
  "blockdevices": [
    {"name":"sda","path":"/dev/sda","model":"Samsung SSD 860","size":500107862016,"fstype":null,"mountpoint":null,"type":"disk",
      "children":[
        {"name":"sda1","path":"/dev/sda1","model":null,"size":524288000,"fstype":"vfat","mountpoint":"/boot/efi","type":"part"},
        {"name":"sda2","path":"/dev/sda2","model":null,"size":499582574016,"fstype":"ext4","mountpoint":"/","type":"part"}
      ]},
    {"name":"sdb","path":"/dev/sdb","model":"WD Blue","size":1000204886016,"fstype":null,"mountpoint":null,"type":"disk"},
    {"name":"sdc","path":"/dev/sdc","model":"Seagate Data","size":2000398934016,"fstype":"ext4","mountpoint":null,"mountpoints":["/data"],"type":"disk"}
  ]
}`

func parseDrives(t *testing.T, dataTarget string) map[string]Drive {
	t.Helper()
	devs, err := parseLsblk([]byte(lsblkSample))
	if err != nil {
		t.Fatalf("parseLsblk: %v", err)
	}
	out := map[string]Drive{}
	for _, d := range devs {
		if d.Type == "disk" {
			out[d.Path] = toDrive(d, dataTarget)
		}
	}
	return out
}

func TestParseAndProject(t *testing.T) {
	drives := parseDrives(t, "/dev/sdc")
	if len(drives) != 3 {
		t.Fatalf("want 3 disks, got %d", len(drives))
	}

	sda := drives["/dev/sda"]
	if !sda.System {
		t.Error("sda holds / on a partition — must be flagged System")
	}
	if sda.SizeBytes != 500107862016 {
		t.Errorf("sda size: got %d", sda.SizeBytes)
	}

	sdb := drives["/dev/sdb"]
	if sdb.System {
		t.Error("sdb is a blank disk — must not be System")
	}
	if sdb.Filesystem != "" || sdb.Mountpoint != "" {
		t.Errorf("sdb should be unformatted+unmounted, got fs=%q mp=%q", sdb.Filesystem, sdb.Mountpoint)
	}
	if sdb.Model != "WD Blue" {
		t.Errorf("sdb model: got %q", sdb.Model)
	}

	sdc := drives["/dev/sdc"]
	if sdc.System {
		t.Error("sdc is a data disk — must not be System")
	}
	if sdc.Filesystem != "ext4" {
		t.Errorf("sdc fs: got %q", sdc.Filesystem)
	}
	if sdc.Mountpoint != "/data" {
		t.Errorf("sdc should resolve mountpoint from the mountpoints array, got %q", sdc.Mountpoint)
	}
	if !sdc.IsDataTarget {
		t.Error("sdc is the configured data target")
	}
	if sdb.IsDataTarget {
		t.Error("sdb is not the data target")
	}
}

func TestFlexUint64FromString(t *testing.T) {
	// Some lsblk builds emit --bytes sizes as quoted strings.
	devs, err := parseLsblk([]byte(`{"blockdevices":[{"name":"sdd","path":"/dev/sdd","size":"123456","type":"disk"}]}`))
	if err != nil {
		t.Fatalf("parseLsblk: %v", err)
	}
	if got := toDrive(devs[0], "").SizeBytes; got != 123456 {
		t.Errorf("string size: got %d, want 123456", got)
	}
}

func TestValidMountpoint(t *testing.T) {
	ok := []string{"/data", "/mnt/data", "/srv/games"}
	for _, mp := range ok {
		if err := validMountpoint(mp); err != nil {
			t.Errorf("validMountpoint(%q) = %v, want nil", mp, err)
		}
	}
	bad := []string{"", "/", "relative", "/boot", "/usr", "/data/", "/data/../etc", "//data"}
	for _, mp := range bad {
		if err := validMountpoint(mp); err == nil {
			t.Errorf("validMountpoint(%q) = nil, want error", mp)
		}
	}
}

func TestValidFilesystem(t *testing.T) {
	for _, fs := range []string{"ext4", "xfs", "btrfs"} {
		if err := validFilesystem(fs); err != nil {
			t.Errorf("validFilesystem(%q) = %v, want nil", fs, err)
		}
	}
	for _, fs := range []string{"ntfs", "vfat", "", "ext4; rm -rf"} {
		if err := validFilesystem(fs); err == nil {
			t.Errorf("validFilesystem(%q) = nil, want error", fs)
		}
	}
}

func TestDeviceRE(t *testing.T) {
	for _, d := range []string{"/dev/sda", "/dev/sdb1", "/dev/nvme0n1", "/dev/vda"} {
		if !deviceRE.MatchString(d) {
			t.Errorf("deviceRE rejected valid device %q", d)
		}
	}
	for _, d := range []string{"/dev/disk/by-id/x", "/dev/../etc/passwd", "/dev/sda;reboot", "sda", "/dev/"} {
		if deviceRE.MatchString(d) {
			t.Errorf("deviceRE accepted bad device %q", d)
		}
	}
}
