package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	uinputPath   = "/dev/uinput"
	evKey        = 0x01
	evSyn        = 0x00
	synReport    = 0x00
	busUsb       = 0x03
	uiDevCreate  = 0x5501
	uiDevDestroy = 0x5502
	uiSetEvBit   = 0x40045564
	uiSetKeyBit  = 0x40045565
	maxKey       = 0x2ff
)

type inputEvent struct {
	Time  syscall.Timeval
	Type  uint16
	Code  uint16
	Value int32
}

type uinputUserDev struct {
	Name        [80]byte
	ID          struct{ Bus, Vendor, Product, Version uint16 }
	FFEffectsMax uint32
	AbsMax      [64]int32
	AbsMin      [64]int32
	AbsFuzz     [64]int32
	AbsFlat     [64]int32
}

var keyMap = map[string]uint16{
	"f":     33,
	"c":     46,
	"F11":   87,
	"F5":    63,
	"F9":    66,
	"F10":   67,
	"tab":   15,
	"esc":   1,
	"enter": 28,
	"up":    103,
	"down":  108,
	"left":  105,
	"right": 106,
	"v":     47,
	"space": 57,
}

var ctrlKeys = map[string]uint16{
	"ctrl_c": 46,
	"ctrl_d": 32,
	"ctrl_z": 44,
	"ctrl_l": 38,
	"ctrl_a": 30,
	"ctrl_e": 18,
	"ctrl_w": 17,
	"ctrl_u": 22,
}

func ioctl(fd, op uintptr, data unsafe.Pointer) error {
	if _, _, err := syscall.Syscall(syscall.SYS_IOCTL, fd, op, uintptr(data)); err != 0 {
		return err
	}
	return nil
}

func writeEvent(fd uintptr, eType, code uint16, value int32) error {
	ev := inputEvent{Type: eType, Code: code, Value: value}
	_, err := syscall.Write(int(fd), (*(*[unsafe.Sizeof(ev)]byte)(unsafe.Pointer(&ev)))[:])
	return err
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: sendkey <key> [player]")
		fmt.Fprintln(os.Stderr, "keys: f, c, F11, F5, F9, F10, tab, esc, enter, up, down, left, right, space")
		fmt.Fprintln(os.Stderr, "ctrl combos: ctrl_c, ctrl_d, ctrl_z, ctrl_l, ctrl_a, ctrl_e, ctrl_w, ctrl_u")
		os.Exit(1)
	}

	keyName := os.Args[1]
	keyCode, ok := keyMap[keyName]
	ctrlCode, isCtrl := ctrlKeys[keyName]
	if !ok && !isCtrl {
		fmt.Fprintf(os.Stderr, "unknown key: %s\n", keyName)
		os.Exit(1)
	}

	player := ""
	if len(os.Args) > 2 {
		player = os.Args[2]
	}

	if player != "" {
		busName := "org.mpris.MediaPlayer2." + strings.ReplaceAll(player, ".", "_")
		exec.Command("gdbus", "call", "--session",
			"--dest", busName,
			"--object-path", "/org/mpris/MediaPlayer2",
			"--method", "org.mpris.MediaPlayer2.Raise").Run()
		time.Sleep(200 * time.Millisecond)
	}

	fd, err := syscall.Open(uinputPath, syscall.O_RDWR, 0)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to open uinput: %v\n", err)
		os.Exit(1)
	}
	defer syscall.Close(fd)

	if err := ioctl(uintptr(fd), uiSetEvBit, unsafe.Pointer(uintptr(evKey))); err != nil {
		fmt.Fprintf(os.Stderr, "UI_SET_EVBIT KEY: %v\n", err)
		os.Exit(1)
	}

	if err := ioctl(uintptr(fd), uiSetEvBit, unsafe.Pointer(uintptr(evSyn))); err != nil {
		fmt.Fprintf(os.Stderr, "UI_SET_EVBIT SYN: %v\n", err)
		os.Exit(1)
	}

	for k := uintptr(0); k <= maxKey; k++ {
		if ioctl(uintptr(fd), uiSetKeyBit, unsafe.Pointer(k)) != nil {
			break
		}
	}

	dev := uinputUserDev{}
	copy(dev.Name[:], []byte("tab-dashboard-keyboard"))
	dev.ID.Bus = busUsb
	dev.ID.Vendor = 1
	dev.ID.Product = 1
	dev.ID.Version = 1

	buf := (*(*[unsafe.Sizeof(dev)]byte)(unsafe.Pointer(&dev)))[:]
	if _, err := syscall.Write(int(fd), buf); err != nil {
		fmt.Fprintf(os.Stderr, "write dev struct: %v\n", err)
		os.Exit(1)
	}

	if err := ioctl(uintptr(fd), uiDevCreate, unsafe.Pointer(nil)); err != nil {
		fmt.Fprintf(os.Stderr, "UI_DEV_CREATE: %v\n", err)
		os.Exit(1)
	}
	defer ioctl(uintptr(fd), uiDevDestroy, unsafe.Pointer(nil))

	time.Sleep(100 * time.Millisecond)

	if isCtrl {
		writeEvent(uintptr(fd), evKey, 29, 1) // KEY_LEFTCTRL down
		writeEvent(uintptr(fd), evKey, ctrlCode, 1)
		writeEvent(uintptr(fd), evSyn, synReport, 0)
		time.Sleep(50 * time.Millisecond)
		writeEvent(uintptr(fd), evKey, ctrlCode, 0)
		writeEvent(uintptr(fd), evKey, 29, 0) // KEY_LEFTCTRL up
		writeEvent(uintptr(fd), evSyn, synReport, 0)
	} else {
		writeEvent(uintptr(fd), evKey, keyCode, 1)
		writeEvent(uintptr(fd), evSyn, synReport, 0)
		time.Sleep(50 * time.Millisecond)
		writeEvent(uintptr(fd), evKey, keyCode, 0)
		writeEvent(uintptr(fd), evSyn, synReport, 0)
	}

	fmt.Fprintf(os.Stderr, "sent key %s\n", keyName)
}
