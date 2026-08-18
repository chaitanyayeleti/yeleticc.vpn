#include <QApplication>
#include <QFileDialog>
#include <QDir>
#include <iostream>

int main(int argc, char *argv[]) {
    QApplication app(argc, argv);
    QString initialDir = QDir::homePath() + "/Downloads";
    if (argc > 1) {
        initialDir = QString::fromUtf8(argv[1]);
    }
    QString file = QFileDialog::getOpenFileName(
        nullptr,
        "Select WireGuard Configuration (.conf)",
        initialDir,
        "WireGuard Config (*.conf);;All Files (*)"
    );
    if (!file.isEmpty()) {
        std::cout << file.toUtf8().constData() << std::endl;
        return 0;
    }
    return 1;
}
